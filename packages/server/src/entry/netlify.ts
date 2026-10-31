import { openNetlifyBlobs } from "../storage/netlify-blobs.ts";
import { functionApp } from "./functions.ts";

const app = functionApp(openNetlifyBlobs({ name: "flow-sync" }), "x-nf-client-connection-ip");

export default (request: Request) => app.fetch(request);

/** Netlify routes every path to this function. */
export const config = { path: "/*" };
