export { default } from "../../../packages/server/src/entry/netlify.ts";

// Netlify reads this from the function file itself: every path goes to the server.
export const config = { path: "/*" };
