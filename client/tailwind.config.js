/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    /*
     * Overridden, not extended. `extend.screens` appends new breakpoints *after*
     * 2xl in the generated stylesheet, so an `xs:` rule would win over `sm:` at
     * 640px. Listing the whole ladder keeps source order == size order.
     *
     * `xs` exists for one job, and currently has exactly one user: the gallery grid
     * wants "3 columns at 360, 4 at 390+", because the unprefixed base has to survive a
     * 360px Android. Everything else is written mobile-first, where the phone is the
     * base and sm:/md: scale up.
     */
    screens: {
      xs: "390px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      /*
       * MOBILE-FIRST TYPE RAMP -- every step is one notch larger than stock Tailwind.
       *
       * This app is read at arm's length on a ~412px phone, where the stock ramp
       * rendered as 14px (119 x text-sm) and 12px (25 x text-xs) and was unusable.
       * Rather than sweep 144 class names -- which treats one scale decision as 144
       * individual ones, and costs another 144 edits the next time it needs tuning --
       * the scale itself moved. So `text-sm` is 16px here, not 14.
       *
       * `text-sm` is the body size and is 16px on purpose: below 16px, mobile
       * Chrome and Safari zoom the page when an input takes focus.
       */
      fontSize: {
        "2xs": ["0.75rem", { lineHeight: "1rem" }], // 12 -- badges, the +N overflow
        xs: ["0.875rem", { lineHeight: "1.25rem" }], // 14 -- meta, captions
        sm: ["1rem", { lineHeight: "1.5rem" }], // 16 -- BODY (was 14)
        base: ["1.0625rem", { lineHeight: "1.5rem" }], // 17
        lg: ["1.25rem", { lineHeight: "1.75rem" }], // 20 -- row titles
        xl: ["1.375rem", { lineHeight: "1.875rem" }], // 22
        "2xl": ["1.75rem", { lineHeight: "2.125rem" }], // 28 -- page h1 (was 24)
        "3xl": ["2rem", { lineHeight: "2.375rem" }], // 32
      },
    },
  },
  plugins: [],
};
