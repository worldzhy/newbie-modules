/// The typed contract of a single emitted event: key + payload type + human
/// metadata. Each emitting module defines its contracts in its own
/// `<module>.events.ts` file; the host activates them through its
/// event-declarations wiring (ADR-028). Modules never self-register.
export interface EventDeclaration<Payload = unknown> {
  key: string;
  name?: string;
  description?: string;
  payloadExample?: Payload;
}

/// Identity function whose only job is to bind the payload type: the generic
/// makes `payloadExample` compile-checked against the emit-site payload type,
/// so an example can never silently drift from the real payload shape.
export function defineEvent<Payload>(declaration: EventDeclaration<Payload>): EventDeclaration<Payload> {
  return declaration;
}
