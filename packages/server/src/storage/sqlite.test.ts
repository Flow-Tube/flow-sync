import { storageContract } from "./contract.ts";
import { openSqlite } from "./sqlite.ts";

storageContract("sqlite", () => openSqlite(":memory:"));
