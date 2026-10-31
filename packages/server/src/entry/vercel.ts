import { openVercelBlobs } from "../storage/vercel-blob.ts";
import { functionApp } from "./functions.ts";

// Vercel sets x-real-ip to the client's address. A default export with `fetch` is a Vercel Function.
export default functionApp(openVercelBlobs(), "x-real-ip");
