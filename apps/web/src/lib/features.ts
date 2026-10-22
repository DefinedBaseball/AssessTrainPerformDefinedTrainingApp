/* Feature switches read at build time.

   Parent self sign-up: the public "I'm a Parent" option on Create an
   account. Off on the live site until the academy is ready to offer it --
   parents can still join through a coach's Add Parent invite link, which
   always works. On in local development. Turn it on live by setting
   NEXT_PUBLIC_ENABLE_PARENT_SIGNUP=true on the web service (and
   PARENT_SELF_SIGNUP=true on the API, which enforces the same rule). */
export const PARENT_SELF_SIGNUP =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_ENABLE_PARENT_SIGNUP === 'true';
