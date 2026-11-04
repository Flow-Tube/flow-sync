import { toHex } from "./bytes.ts";
import { FlowSyncError, fail } from "./errors.ts";
import { applyEntry, type Entry, entryHash, forkWinner, type RosterState } from "./roster.ts";

export const MAX_ROSTER_ENTRIES = 4096;

export interface ForkResolution {
  chain: Entry[];
  contested: Entry[];
  /** The contested entries that revoke another contested entry: what the user chooses between. */
  sides: Entry[];
}

export type RosterSettlement =
  | { outcome: "apply"; chain: Entry[]; extendsApplied: boolean }
  | { outcome: "contested"; contested: Entry[]; sides: Entry[] }
  | { outcome: "rollback" }
  | { outcome: "rewritten" };

interface Node {
  entry: Entry;
  hash: string;
  state: RosterState;
  parent: Node | undefined;
  children: Node[];
  revokes: Node[];
  waiting: number;
  enter: number;
  exit: number;
  status?: "stands" | "falls";
}

const hashOf = (entry: Entry) => toHex(entryHash(entry));

/** Every held entry that is valid against its parent, as a tree. */
function validTree(group: string, held: Entry[], genesis?: string): Node[] {
  const nodes = new Map<string, Node>();
  for (const entry of [...held].sort((a, b) => a.seq - b.seq)) {
    const hash = hashOf(entry);
    if (nodes.size >= MAX_ROSTER_ENTRIES) fail("roster-chain");
    if (nodes.has(hash) || entry.group !== group) continue;
    if (genesis && entry.op === "genesis" && hash !== genesis) continue;
    const parent = entry.op === "genesis" ? undefined : nodes.get(entry.prev);
    if (!parent && entry.op !== "genesis") continue;
    try {
      const state = applyEntry(parent?.state, entry);
      const node = {
        entry,
        hash,
        state,
        parent,
        children: [],
        revokes: [],
        waiting: 0,
        enter: 0,
        exit: 0,
      };
      nodes.set(hash, node);
      parent?.children.push(node);
    } catch (error) {
      if (!(error instanceof FlowSyncError)) throw error;
    }
  }
  return [...nodes.values()];
}

/** Numbers the tree so that an ancestor check takes constant time. */
function numberTree(nodes: Node[]): void {
  let clock = 0;
  for (const root of nodes.filter((node) => !node.parent)) {
    const stack: [Node, number][] = [[root, 0]];
    root.enter = clock++;
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as [Node, number];
      const child = top[0].children[top[1]++];
      if (child) {
        child.enter = clock++;
        stack.push([child, 0]);
      } else {
        top[0].exit = clock++;
        stack.pop();
      }
    }
  }
}

const isAncestorOrSelf = (x: Node, y: Node) => x.enter <= y.enter && y.exit <= x.exit;

function linkRevocations(nodes: Node[], pins: ReadonlySet<string>): void {
  const bySigner = new Map<string, Node[]>();
  for (const node of nodes) {
    const signed = bySigner.get(node.entry.signer);
    if (signed) signed.push(node);
    else bySigner.set(node.entry.signer, [node]);
  }
  for (const y of nodes) {
    for (const did of y.entry.remove ?? []) {
      for (const x of bySigner.get(did) ?? []) {
        if (pins.has(x.hash) || isAncestorOrSelf(x, y)) continue;
        y.revokes.push(x);
        x.waiting++;
      }
    }
  }
}

/** Decides what it can: whatever is left has no status, and is contested. */
function decide(nodes: Node[]): void {
  const queue: Node[] = [];
  const settle = (node: Node, status: "stands" | "falls") => {
    if (node.status) return;
    node.status = status;
    queue.push(node);
  };
  const mayStand = (node: Node) =>
    node.waiting === 0 && (!node.parent || node.parent.status === "stands");
  for (const node of nodes) if (mayStand(node)) settle(node, "stands");
  for (let node = queue.pop(); node; node = queue.pop()) {
    for (const child of node.children) {
      if (node.status === "falls") settle(child, "falls");
      else if (mayStand(child)) settle(child, "stands");
    }
    for (const revoked of node.revokes) {
      if (node.status === "stands") settle(revoked, "falls");
      else {
        revoked.waiting--;
        if (mayStand(revoked)) settle(revoked, "stands");
      }
    }
  }
}

/** The fork rule from protocol.md: a function of the entries held, never of their order. */
export function resolveForks(
  group: string,
  held: Entry[],
  pins: ReadonlySet<string> = new Set(),
  genesis?: string,
): ForkResolution {
  const nodes = validTree(group, held, genesis);
  numberTree(nodes);
  linkRevocations(nodes, pins);
  decide(nodes);

  const open = nodes.filter((node) => !node.status);
  if (open.length > 0) {
    const sides = open.filter((node) => node.revokes.some((x) => !x.status));
    return {
      chain: [],
      contested: open.map((node) => node.entry),
      sides: sides.map((node) => node.entry),
    };
  }

  const chain: Entry[] = [];
  let candidates = nodes.filter((node) => !node.parent && node.status === "stands");
  while (candidates.length > 0) {
    const winner = forkWinner(candidates.map((node) => node.entry));
    chain.push(winner);
    const node = candidates.find((candidate) => candidate.entry === winner) as Node;
    candidates = node.children.filter((child) => child.status === "stands");
  }
  return { chain, contested: [], sides: [] };
}

/**
 * What a device does with a store's view of the roster. `applied` is the chain it has verified.
 * `linear` is a Flow server, which has no honest way to change an entry it already answered with.
 */
export function settleRoster(input: {
  group: string;
  applied: Entry[];
  view: Entry[];
  pins?: ReadonlySet<string>;
  linear?: boolean;
}): RosterSettlement {
  const { group, applied, view, pins = new Set(), linear = false } = input;
  const seen = new Set(view.map(hashOf));
  if (applied.some((entry) => !seen.has(hashOf(entry)))) return { outcome: "rollback" };

  const first = applied[0];
  const { chain, contested, sides } = resolveForks(group, view, pins, first && hashOf(first));
  if (contested.length > 0) return { outcome: "contested", contested, sides };
  if (chain.length === 0) fail("roster-chain");

  const extendsApplied =
    applied.length <= chain.length &&
    applied.every((entry, i) => hashOf(entry) === hashOf(chain[i] as Entry));
  if (!extendsApplied && linear) return { outcome: "rewritten" };
  return { outcome: "apply", chain, extendsApplied };
}
