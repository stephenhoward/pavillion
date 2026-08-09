/**
 * Host reduction for inbound `Flag` reporters.
 *
 * A Flag's actor is a remote moderation reporter. Nothing durable — log line,
 * rejection record, or notification row — may carry that identity at finer
 * granularity than the reporting instance's host. Instance blocking is decided
 * and audited at host granularity, so the host is retained and everything
 * narrower is dropped.
 *
 * The canonical statement of this rule is `anonymizeFlagActor` in the
 * notifications domain, which applies it to the `notification_activity` row.
 * That module cannot be imported here — domain boundaries forbid it
 * ([DEC-003](../../../../agent-os/product/decisions/dec-003-domain-driven-architecture.md))
 * — so this helper restates the reduction for the ActivityPub domain's own
 * inbox paths. Keep the two consistent: `anonymizeFlagActor` is the rule of
 * record.
 */

/**
 * Reduce a Flag reporter to a bare instance URI.
 *
 * @param domain - The reporter's hostname, as extracted from its actor URI
 * @returns An origin-only URI for that host
 */
export function flagActorHostUri(domain: string): string {
  return `https://${domain}`;
}
