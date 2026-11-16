import type { Session, User } from '@supabase/supabase-js';

/** One load operation may reuse identity verification, never household authorization. */
export class SessionVerification {
  private result: Promise<User> | undefined;
  private readonly session: Session;
  private readonly verify: () => Promise<User>;
  constructor(session: Session, verify: () => Promise<User>) {
    this.session = session;
    this.verify = verify;
  }

  getUser(session: Session): Promise<User> {
    if (session.user.id !== this.session.user.id || session.access_token !== this.session.access_token) {
      return Promise.reject(new Error('The signed-in account changed while loading. Try again.'));
    }
    return this.result ??= this.verify().then(user => {
      if (user.id !== session.user.id) throw new Error('Your signed-in account could not be verified.');
      return user;
    });
  }
}
