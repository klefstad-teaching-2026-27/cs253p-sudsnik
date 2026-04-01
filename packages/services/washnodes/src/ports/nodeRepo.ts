export interface NodeRepo {
  inContact(nodeId: string): boolean;
  setContact(nodeId: string, inContact: boolean, nowMs: number): void;
}
