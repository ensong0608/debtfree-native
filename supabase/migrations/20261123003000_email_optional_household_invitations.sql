-- Allow shareable, email-optional household invitations while preserving
-- email-bound verification whenever an invitee email is specified.
BEGIN;

ALTER TABLE public.debtfree_household_invitations
  ALTER COLUMN invitee_email DROP NOT NULL;

ALTER TABLE public.debtfree_household_invitations
  DROP CONSTRAINT IF EXISTS debtfree_household_invitations_invitee_email_nonempty_check;

ALTER TABLE public.debtfree_household_invitations
  ADD CONSTRAINT debtfree_household_invitations_invitee_email_nonempty_check
  CHECK (invitee_email IS NULL OR pg_catalog.length(invitee_email) > 0);

CREATE OR REPLACE FUNCTION public.debtfree_create_household_invitation(
  p_household_id text,
  p_expected_membership_version bigint,
  p_invitee_email text,
  p_role text,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_version bigint;
  v_email text;
  v_id uuid;
  v_expired integer;
  v_expires timestamptz;
BEGIN
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_role IS NULL OR p_role NOT IN ('admin', 'viewer')
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE = '22023';
  END IF;

  v_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_invitee_email, ''))), '');
  IF v_email IS NOT NULL AND (pg_catalog.length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Invalid invitation email' USING ERRCODE = '22023';
  END IF;

  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id, p_expected_membership_version, 'update');

  UPDATE public.debtfree_household_invitations
    SET status = 'expired', updated_at = pg_catalog.clock_timestamp()
    WHERE household_id = p_household_id AND status = 'pending' AND expires_at <= pg_catalog.clock_timestamp();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  IF v_expired > 0 THEN
    IF v_version = 9223372036854775807 THEN
      RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003';
    END IF;
    UPDATE public.households
      SET membership_version = membership_version + 1
      WHERE id = p_household_id
      RETURNING membership_version INTO v_version;
    RETURN pg_catalog.jsonb_build_object('status', 'membership_version_conflict', 'membershipVersion', v_version::text);
  END IF;

  IF (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.household_id = p_household_id AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.actor_id = v_actor AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Invitation rate limit reached' USING ERRCODE = 'P0001';
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.household_members hm
    JOIN auth.users u ON u.id = hm.user_id
    WHERE hm.household_id = p_household_id
      AND hm.status = 'active'
      AND pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
  ) THEN
    RAISE EXCEPTION 'Email already belongs to an active member' USING ERRCODE = '23505';
  END IF;

  IF (SELECT count(*) FROM public.household_members hm WHERE hm.household_id = p_household_id AND hm.status = 'active')
     + (SELECT count(*) FROM public.debtfree_household_invitations i WHERE i.household_id = p_household_id AND i.status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'Household capacity reached' USING ERRCODE = 'P0001';
  END IF;

  IF v_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003';
  END IF;

  v_expires := pg_catalog.clock_timestamp() + interval '7 days';
  INSERT INTO public.debtfree_household_invitations (household_id, invitee_email, requested_role, token_hash, invited_by, expires_at)
    VALUES (p_household_id, v_email, p_role, p_token_hash, v_actor, v_expires)
    RETURNING id INTO v_id;

  INSERT INTO public.debtfree_household_invitation_send_events (household_id, actor_id)
    VALUES (p_household_id, v_actor);

  UPDATE public.households
    SET membership_version = membership_version + 1
    WHERE id = p_household_id
    RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'created',
    'invitationId', v_id,
    'householdId', p_household_id,
    'role', CASE WHEN p_role = 'admin' THEN 'member' ELSE p_role END,
    'expiresAt', v_expires,
    'deliveryState', 'prepared',
    'hasEmail', (v_email IS NOT NULL),
    'membershipVersion', v_version::text
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.debtfree_list_household_invitations(
  p_household_id text,
  p_expected_membership_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version bigint;
  v_items jsonb;
BEGIN
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN
    RAISE EXCEPTION 'Invalid membership version' USING ERRCODE = '22023';
  END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id, p_expected_membership_version, 'share');
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'invitationId', i.id,
        'emailHint', CASE
          WHEN i.invitee_email IS NULL THEN NULL
          ELSE pg_catalog.left(pg_catalog.split_part(i.invitee_email, '@', 1), 1) || '***@' || pg_catalog.split_part(i.invitee_email, '@', 2)
        END,
        'role', CASE WHEN i.requested_role = 'admin' THEN 'member' ELSE i.requested_role END,
        'expiresAt', i.expires_at,
        'expired', i.expires_at <= pg_catalog.clock_timestamp(),
        'deliveryState', i.delivery_state
      )
      ORDER BY i.created_at, i.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.debtfree_household_invitations i
  WHERE i.household_id = p_household_id AND i.status = 'pending';

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok',
    'householdId', p_household_id,
    'membershipVersion', v_version::text,
    'invitations', v_items
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.debtfree_rotate_household_invitation(
  p_household_id text,
  p_invitation_id uuid,
  p_expected_membership_version bigint,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_version bigint;
  v_inv public.debtfree_household_invitations%ROWTYPE;
BEGIN
  IF p_invitation_id IS NULL OR p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE = '22023';
  END IF;
  v_version := public.debtfree_internal_invitation_owner_lock(p_household_id, p_expected_membership_version, 'update');
  IF (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.household_id = p_household_id AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.debtfree_household_invitation_send_events e WHERE e.actor_id = v_actor AND e.created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Invitation rate limit reached' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_inv
    FROM public.debtfree_household_invitations i
    WHERE i.id = p_invitation_id AND i.household_id = p_household_id
    FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'pending' OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF v_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003';
  END IF;
  UPDATE public.debtfree_household_invitations
    SET token_hash = p_token_hash,
        delivery_state = 'prepared',
        expires_at = pg_catalog.clock_timestamp() + interval '7 days',
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_invitation_id
    RETURNING * INTO v_inv;
  INSERT INTO public.debtfree_household_invitation_send_events (household_id, actor_id)
    VALUES (p_household_id, v_actor);
  UPDATE public.households
    SET membership_version = membership_version + 1
    WHERE id = p_household_id
    RETURNING membership_version INTO v_version;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'rotated',
    'invitationId', v_inv.id,
    'householdId', p_household_id,
    'role', CASE WHEN v_inv.requested_role = 'admin' THEN 'member' ELSE v_inv.requested_role END,
    'expiresAt', v_inv.expires_at,
    'deliveryState', 'prepared',
    'hasEmail', (v_inv.invitee_email IS NOT NULL),
    'membershipVersion', v_version::text
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.debtfree_accept_household_invitation(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_inv public.debtfree_household_invitations%ROWTYPE;
  v_locked public.debtfree_household_invitations%ROWTYPE;
  v_owner uuid;
  v_owners uuid[];
  v_before uuid[];
  v_after uuid[];
  v_email text;
  v_confirmed timestamptz;
  v_state text;
  v_version bigint;
  v_existing_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  -- Discovery only; none of these reads authorize a mutation.
  SELECT * INTO v_inv
    FROM public.debtfree_household_invitations i
    WHERE i.token_hash = p_token_hash AND i.status = 'pending';
  IF NOT FOUND OR v_inv.invited_by IS NULL THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id)
    INTO v_owners
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id AND hm.status = 'active' AND hm.role = 'owner';
  IF COALESCE(pg_catalog.cardinality(v_owners), 0) <> 1 OR v_owners[1] IS DISTINCT FROM v_inv.invited_by THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_owner := v_owners[1];

  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id)
    INTO v_before
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id AND hm.status = 'active';

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor, v_inv.invited_by, v_owner], 'update', false);

  -- Auth owns email changes independently of household locks; lock the current
  -- Auth row before household rows so confirmation and email cannot race.
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)), u.email_confirmed_at
    INTO v_email, v_confirmed
    FROM auth.users u
    WHERE u.id = v_actor
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM public.debtfree_internal_lock_households(ARRAY[v_inv.household_id], 'update');
  SELECT h.lifecycle_state, h.membership_version
    INTO v_state, v_version
    FROM public.households h
    WHERE h.id = v_inv.household_id;
  IF v_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id
    ORDER BY hm.user_id
    FOR UPDATE;
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id)
    INTO v_after
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id AND hm.status = 'active';
  SELECT pg_catalog.array_agg(hm.user_id ORDER BY hm.user_id)
    INTO v_owners
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id AND hm.status = 'active' AND hm.role = 'owner';
  IF v_before IS DISTINCT FROM v_after OR COALESCE(pg_catalog.cardinality(v_owners), 0) <> 1 OR v_owners[1] IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Household participants changed; retry operation' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_locked
    FROM public.debtfree_household_invitations i
    WHERE i.id = v_inv.id
    FOR UPDATE;
  IF NOT FOUND OR v_locked.household_id IS DISTINCT FROM v_inv.household_id OR v_locked.invited_by IS DISTINCT FROM v_inv.invited_by
     OR v_locked.token_hash IS DISTINCT FROM p_token_hash OR v_locked.status <> 'pending'
     OR v_locked.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = '42501';
  END IF;

  IF v_locked.invitee_email IS NOT NULL THEN
    IF v_confirmed IS NULL OR v_email IS NULL THEN
      RAISE EXCEPTION 'Confirmed email required' USING ERRCODE = '42501';
    END IF;
    IF v_locked.invitee_email IS DISTINCT FROM v_email THEN
      RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT hm.status INTO v_existing_status
    FROM public.household_members hm
    WHERE hm.household_id = v_inv.household_id AND hm.user_id = v_actor;
  IF FOUND AND v_existing_status = 'active' THEN
    RAISE EXCEPTION 'Already a household member' USING ERRCODE = '23505';
  END IF;

  IF (SELECT count(*) FROM public.household_members hm WHERE hm.household_id = v_inv.household_id AND hm.status = 'active') >= 3
     OR (SELECT count(*) FROM public.household_members hm WHERE hm.household_id = v_inv.household_id AND hm.status = 'active')
       + (SELECT count(*) FROM public.debtfree_household_invitations i WHERE i.household_id = v_inv.household_id AND i.status = 'pending' AND i.expires_at > pg_catalog.clock_timestamp()) > 3 THEN
    RAISE EXCEPTION 'Household capacity reached' USING ERRCODE = 'P0001';
  END IF;

  IF v_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'Membership version exhausted' USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.household_members (household_id, user_id, role, status)
    VALUES (v_inv.household_id, v_actor, v_locked.requested_role, 'active')
    ON CONFLICT (household_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

  UPDATE public.debtfree_household_invitations
    SET status = 'accepted',
        accepted_by = v_actor,
        accepted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_inv.id;

  UPDATE public.households
    SET membership_version = membership_version + 1
    WHERE id = v_inv.household_id
    RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'accepted',
    'userId', v_actor,
    'householdId', v_inv.household_id,
    'role', CASE WHEN v_locked.requested_role = 'admin' THEN 'member' ELSE v_locked.requested_role END,
    'membershipVersion', v_version::text
  );
END
$function$;

REVOKE ALL ON FUNCTION public.debtfree_create_household_invitation(text, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_list_household_invitations(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_rotate_household_invitation(text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_accept_household_invitation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_create_household_invitation(text, bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_list_household_invitations(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_rotate_household_invitation(text, uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_accept_household_invitation(text) TO authenticated;

COMMIT;
