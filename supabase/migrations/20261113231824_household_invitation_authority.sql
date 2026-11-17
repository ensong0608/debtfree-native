-- Invitation authority remains isolated from shared finance until the full
-- household authorization cutover is installed and verified.
BEGIN;

CREATE TABLE public.debtfree_household_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  invitee_email text NOT NULL CHECK (invitee_email = pg_catalog.lower(pg_catalog.btrim(invitee_email)) AND pg_catalog.length(invitee_email) <= 254),
  requested_role text NOT NULL CHECK (requested_role IN ('admin', 'viewer')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  delivery_state text NOT NULL DEFAULT 'prepared' CHECK (delivery_state IN ('prepared', 'sent', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  accepted_at timestamptz
);
CREATE UNIQUE INDEX debtfree_household_invitations_pending_email_idx
  ON public.debtfree_household_invitations (household_id, invitee_email) WHERE status = 'pending';
CREATE INDEX debtfree_household_invitations_household_status_idx
  ON public.debtfree_household_invitations (household_id, status, expires_at);

CREATE TABLE public.debtfree_household_invitation_send_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX debtfree_household_invitation_send_events_household_time_idx
  ON public.debtfree_household_invitation_send_events (household_id, created_at);
CREATE INDEX debtfree_household_invitation_send_events_actor_time_idx
  ON public.debtfree_household_invitation_send_events (actor_id, created_at);
ALTER TABLE public.debtfree_household_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtfree_household_invitation_send_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_household_invitations, public.debtfree_household_invitation_send_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.debtfree_household_invitation_send_events_id_seq FROM PUBLIC, anon, authenticated;

-- Internal owner guard. Callers take invitation-row locks only after this has
-- locked the actor guard, household, and actor membership in that order.
CREATE FUNCTION public.debtfree_internal_invitation_owner_lock(p_household_id text, p_expected_version bigint, p_mode text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_actor uuid := (SELECT auth.uid()); v_version bigint; v_state text; v_role text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('share','update') OR p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id) OR pg_catalog.length(p_household_id) > 120
     OR (p_expected_version IS NOT NULL AND p_expected_version < 1) THEN
    RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], p_mode, false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], p_mode);
  SELECT h.lifecycle_state, h.membership_version INTO v_state, v_version FROM public.households h WHERE h.id = p_household_id;
  IF v_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501'; END IF;
  IF p_mode = 'update' THEN
    SELECT hm.role INTO v_role FROM public.household_members hm WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active' FOR UPDATE;
  ELSE
    SELECT hm.role INTO v_role FROM public.household_members hm WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active' FOR SHARE;
  END IF;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'owner'
     OR (SELECT count(*) FROM public.household_members hm WHERE hm.household_id=p_household_id AND hm.status='active' AND hm.role='owner') <> 1 THEN
    RAISE EXCEPTION 'Owner access required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;
  RETURN v_version;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_invitation_owner_lock(text,bigint,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.debtfree_create_household_invitation(p_household_id text, p_expected_membership_version bigint, p_invitee_email text, p_role text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_actor uuid := (SELECT auth.uid()); v_version bigint; v_email text; v_id uuid; v_expired integer; v_expires timestamptz;
BEGIN
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 OR p_invitee_email IS NULL
     OR p_role IS NULL OR p_role NOT IN ('admin','viewer') OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE = '22023';
  END IF;
  v_email := pg_catalog.lower(pg_catalog.btrim(p_invitee_email));
  IF pg_catalog.length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid invitation email' USING ERRCODE = '22023';
  END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id, p_expected_membership_version, 'update');
  -- Expiry is materialized under the same household lock and changes the seat
  -- version before another reservation is created.
  UPDATE public.debtfree_household_invitations SET status = 'expired', updated_at = pg_catalog.clock_timestamp()
    WHERE household_id = p_household_id AND status = 'pending' AND expires_at <= pg_catalog.clock_timestamp();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  IF v_expired > 0 THEN
    IF v_version = 9223372036854775807 THEN RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003'; END IF;
    UPDATE public.households SET membership_version = membership_version + 1 WHERE id = p_household_id RETURNING membership_version INTO v_version;
    RETURN pg_catalog.jsonb_build_object('status','membership_version_conflict','membershipVersion',v_version::text);
  END IF;
  IF (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.household_id = p_household_id AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.actor_id = v_actor AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Invitation rate limit reached' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.household_members hm JOIN auth.users u ON u.id = hm.user_id
             WHERE hm.household_id = p_household_id AND hm.status = 'active' AND pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email) THEN
    RAISE EXCEPTION 'Email already belongs to an active member' USING ERRCODE = '23505';
  END IF;
  IF (SELECT count(*) FROM public.household_members hm WHERE hm.household_id = p_household_id AND hm.status = 'active')
     + (SELECT count(*) FROM public.debtfree_household_invitations i WHERE i.household_id = p_household_id AND i.status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'Household capacity reached' USING ERRCODE = 'P0001';
  END IF;
  IF v_version = 9223372036854775807 THEN RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003'; END IF;
  v_expires := pg_catalog.clock_timestamp() + interval '7 days';
  INSERT INTO public.debtfree_household_invitations (household_id,invitee_email,requested_role,token_hash,invited_by,expires_at)
    VALUES (p_household_id,v_email,p_role,p_token_hash,v_actor,v_expires) RETURNING id INTO v_id;
  INSERT INTO public.debtfree_household_invitation_send_events (household_id,actor_id) VALUES (p_household_id,v_actor);
  UPDATE public.households SET membership_version = membership_version + 1 WHERE id = p_household_id RETURNING membership_version INTO v_version;
  RETURN pg_catalog.jsonb_build_object('status','created','invitationId',v_id,'householdId',p_household_id,
    'role',CASE WHEN p_role = 'admin' THEN 'member' ELSE p_role END,'expiresAt',v_expires,'deliveryState','prepared','membershipVersion',v_version::text);
END
$function$;

CREATE FUNCTION public.debtfree_list_household_invitations(p_household_id text, p_expected_membership_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_version bigint; v_items jsonb;
BEGIN
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN RAISE EXCEPTION 'Invalid membership version' USING ERRCODE = '22023'; END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id,p_expected_membership_version,'share');
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('invitationId',i.id,'emailHint',
    pg_catalog.left(pg_catalog.split_part(i.invitee_email,'@',1),1) || '***@' || pg_catalog.split_part(i.invitee_email,'@',2),
    'role',CASE WHEN i.requested_role='admin' THEN 'member' ELSE i.requested_role END,'expiresAt',i.expires_at,
    'expired',i.expires_at <= pg_catalog.clock_timestamp(),'deliveryState',i.delivery_state) ORDER BY i.created_at,i.id),'[]'::jsonb)
    INTO v_items FROM public.debtfree_household_invitations i WHERE i.household_id=p_household_id AND i.status='pending';
  RETURN pg_catalog.jsonb_build_object('status','ok','householdId',p_household_id,'membershipVersion',v_version::text,'invitations',v_items);
END
$function$;

CREATE FUNCTION public.debtfree_rotate_household_invitation(p_household_id text, p_invitation_id uuid, p_expected_membership_version bigint, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_actor uuid := (SELECT auth.uid()); v_version bigint; v_inv public.debtfree_household_invitations%ROWTYPE;
BEGIN
  IF p_invitation_id IS NULL OR p_expected_membership_version IS NULL OR p_expected_membership_version < 1 OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE='22023'; END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id,p_expected_membership_version,'update');
  IF (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.household_id=p_household_id AND e.created_at > pg_catalog.clock_timestamp()-interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.actor_id=v_actor AND e.created_at > pg_catalog.clock_timestamp()-interval '1 hour') >= 5 THEN RAISE EXCEPTION 'Invitation rate limit reached' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_inv FROM public.debtfree_household_invitations i WHERE i.id=p_invitation_id AND i.household_id=p_household_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'pending' OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  IF v_version = 9223372036854775807 THEN RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE='22003'; END IF;
  UPDATE public.debtfree_household_invitations SET token_hash=p_token_hash,delivery_state='prepared',expires_at=pg_catalog.clock_timestamp()+interval '7 days',updated_at=pg_catalog.clock_timestamp() WHERE id=p_invitation_id RETURNING * INTO v_inv;
  INSERT INTO public.debtfree_household_invitation_send_events (household_id,actor_id) VALUES (p_household_id,v_actor);
  UPDATE public.households SET membership_version=membership_version+1 WHERE id=p_household_id RETURNING membership_version INTO v_version;
  RETURN pg_catalog.jsonb_build_object('status','rotated','invitationId',v_inv.id,'householdId',p_household_id,
    'role',CASE WHEN v_inv.requested_role='admin' THEN 'member' ELSE v_inv.requested_role END,'expiresAt',v_inv.expires_at,'deliveryState','prepared','membershipVersion',v_version::text);
END
$function$;

-- Only a trusted delivery Edge Function may read the recipient address. Owner
-- RPC responses expose a masked hint; raw recipient email never returns to the
-- native client. The current token hash binds this read to the latest send.
CREATE FUNCTION public.debtfree_get_household_invitation_delivery(p_invitation_id uuid, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inv public.debtfree_household_invitations%ROWTYPE;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service delivery authority required' USING ERRCODE = '42501';
  END IF;
  IF p_invitation_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid delivery request' USING ERRCODE = '22023';
  END IF;
  SELECT i.* INTO v_inv
  FROM public.debtfree_household_invitations AS i
  WHERE i.id = p_invitation_id
    AND i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation delivery is stale' USING ERRCODE = '40001';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'invitationId', v_inv.id,
    'householdId', v_inv.household_id,
    'email', v_inv.invitee_email,
    'role', CASE WHEN v_inv.requested_role = 'admin' THEN 'member' ELSE v_inv.requested_role END,
    'expiresAt', v_inv.expires_at
  );
END
$function$;

CREATE FUNCTION public.debtfree_cancel_household_invitation(p_household_id text, p_invitation_id uuid, p_expected_membership_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_version bigint; v_status text;
BEGIN
  IF p_invitation_id IS NULL OR p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE='22023'; END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id,p_expected_membership_version,'update');
  SELECT i.status INTO v_status FROM public.debtfree_household_invitations i WHERE i.id=p_invitation_id AND i.household_id=p_household_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending' THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  IF v_version = 9223372036854775807 THEN RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE='22003'; END IF;
  UPDATE public.debtfree_household_invitations SET status='revoked',updated_at=pg_catalog.clock_timestamp() WHERE id=p_invitation_id;
  UPDATE public.households SET membership_version=membership_version+1 WHERE id=p_household_id RETURNING membership_version INTO v_version;
  RETURN pg_catalog.jsonb_build_object('status','revoked','membershipVersion',v_version::text);
END
$function$;

-- Delivery proof is '<current-token-hash>:sent' or ':uncertain'. A response
-- from an earlier send cannot mark a newly rotated token as delivered.
CREATE FUNCTION public.debtfree_set_household_invitation_delivery(p_household_id text, p_invitation_id uuid, p_delivery_proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_version bigint; v_hash text; v_state text; v_inv public.debtfree_household_invitations%ROWTYPE;
BEGIN
  IF p_invitation_id IS NULL OR p_delivery_proof IS NULL OR p_delivery_proof !~ '^[0-9a-f]{64}:(sent|uncertain)$' THEN RAISE EXCEPTION 'Invalid delivery proof' USING ERRCODE='22023'; END IF;
  v_hash := pg_catalog.split_part(p_delivery_proof,':',1); v_state := pg_catalog.split_part(p_delivery_proof,':',2);
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id,NULL,'share');
  SELECT * INTO v_inv FROM public.debtfree_household_invitations i WHERE i.id=p_invitation_id AND i.household_id=p_household_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'pending' OR v_inv.expires_at <= pg_catalog.clock_timestamp() OR v_inv.token_hash <> v_hash THEN RAISE EXCEPTION 'Invitation delivery is stale' USING ERRCODE='40001'; END IF;
  UPDATE public.debtfree_household_invitations SET delivery_state=v_state,updated_at=pg_catalog.clock_timestamp() WHERE id=p_invitation_id;
  RETURN pg_catalog.jsonb_build_object('status','updated','membershipVersion',v_version::text,'deliveryState',v_state);
END
$function$;

CREATE FUNCTION public.debtfree_accept_household_invitation(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid()); v_inv public.debtfree_household_invitations%ROWTYPE; v_locked public.debtfree_household_invitations%ROWTYPE;
  v_owner uuid; v_owners uuid[]; v_before uuid[]; v_after uuid[]; v_email text; v_confirmed timestamptz; v_state text; v_version bigint; v_existing_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='22023'; END IF;
  -- Discovery only; none of these reads authorize a mutation.
  SELECT * INTO v_inv FROM public.debtfree_household_invitations i WHERE i.token_hash=p_token_hash AND i.status='pending';
  IF NOT FOUND OR v_inv.invited_by IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id) INTO v_owners FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active' AND hm.role='owner';
  IF COALESCE(pg_catalog.cardinality(v_owners),0) <> 1 OR v_owners[1] IS DISTINCT FROM v_inv.invited_by THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  v_owner := v_owners[1];
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id) INTO v_before FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active';
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor,v_inv.invited_by,v_owner],'update',false);
  -- Auth owns email changes independently of household locks; lock the current
  -- Auth row before household rows so confirmation and email cannot race.
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)),u.email_confirmed_at INTO v_email,v_confirmed FROM auth.users u WHERE u.id=v_actor FOR SHARE;
  IF NOT FOUND OR v_confirmed IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'Confirmed email required' USING ERRCODE='42501'; END IF;
  PERFORM public.debtfree_internal_lock_households(ARRAY[v_inv.household_id],'update');
  SELECT h.lifecycle_state,h.membership_version INTO v_state,v_version FROM public.households h WHERE h.id=v_inv.household_id;
  IF v_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Household access denied' USING ERRCODE='42501'; END IF;
  PERFORM hm.user_id FROM public.household_members hm WHERE hm.household_id=v_inv.household_id ORDER BY hm.user_id FOR UPDATE;
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id) INTO v_after FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active';
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id) INTO v_owners FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active' AND hm.role='owner';
  IF v_before IS DISTINCT FROM v_after OR COALESCE(pg_catalog.cardinality(v_owners),0) <> 1 OR v_owners[1] IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Household participants changed; retry operation' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_locked FROM public.debtfree_household_invitations i WHERE i.id=v_inv.id FOR UPDATE;
  IF NOT FOUND OR v_locked.household_id IS DISTINCT FROM v_inv.household_id OR v_locked.invited_by IS DISTINCT FROM v_inv.invited_by
     OR v_locked.token_hash IS DISTINCT FROM p_token_hash OR v_locked.status <> 'pending' OR v_locked.expires_at <= pg_catalog.clock_timestamp()
     OR v_locked.invitee_email IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  SELECT hm.status INTO v_existing_status FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.user_id=v_actor;
  IF FOUND AND v_existing_status='active' THEN RAISE EXCEPTION 'Already a household member' USING ERRCODE='23505'; END IF;
  IF (SELECT count(*) FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active') >= 3
     OR (SELECT count(*) FROM public.household_members hm WHERE hm.household_id=v_inv.household_id AND hm.status='active')
       + (SELECT count(*) FROM public.debtfree_household_invitations i WHERE i.household_id=v_inv.household_id AND i.status='pending' AND i.expires_at > pg_catalog.clock_timestamp()) > 3 THEN
    RAISE EXCEPTION 'Household capacity reached' USING ERRCODE='P0001';
  END IF;
  IF v_version = 9223372036854775807 THEN RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE='22003'; END IF;
  INSERT INTO public.household_members (household_id,user_id,role,status) VALUES (v_inv.household_id,v_actor,v_locked.requested_role,'active')
    ON CONFLICT (household_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active';
  UPDATE public.debtfree_household_invitations SET status='accepted',accepted_by=v_actor,accepted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() WHERE id=v_inv.id;
  UPDATE public.households SET membership_version=membership_version+1 WHERE id=v_inv.household_id RETURNING membership_version INTO v_version;
  RETURN pg_catalog.jsonb_build_object('status','accepted','userId',v_actor,'householdId',v_inv.household_id,
    'role',CASE WHEN v_locked.requested_role='admin' THEN 'member' ELSE v_locked.requested_role END,'membershipVersion',v_version::text);
END
$function$;

REVOKE ALL ON FUNCTION public.debtfree_create_household_invitation(text,bigint,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_list_household_invitations(text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_rotate_household_invitation(text,uuid,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_cancel_household_invitation(text,uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_set_household_invitation_delivery(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_accept_household_invitation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_get_household_invitation_delivery(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_create_household_invitation(text,bigint,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_list_household_invitations(text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_rotate_household_invitation(text,uuid,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_cancel_household_invitation(text,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_set_household_invitation_delivery(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_accept_household_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_get_household_invitation_delivery(uuid,text) TO service_role;

COMMIT;
