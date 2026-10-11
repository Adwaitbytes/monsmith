// Privy's fiat on-ramp screen imports @stripe/crypto, which expects
// @stripe/stripe-js. Monsmith does not offer a fiat on-ramp, so the screen
// never opens; this stands in for the package so the bundle resolves without
// shipping Stripe. If the on-ramp is ever turned on, install the real package.
export const loadStripe = async () => null;
