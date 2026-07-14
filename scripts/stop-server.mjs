import process from "node:process";

process.argv[2] = "stop";
await import("./server-control.mjs");
