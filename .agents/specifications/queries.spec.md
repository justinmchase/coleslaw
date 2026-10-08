# Queries

This chapter defines bounded collection reads, declared filtering and ordering,
live cursor pages, and the mode capability for full traversal. It covers
projection reads and collection-returning service queries, not aggregate
commands or the storage work needed to build a projection. Terms are defined
in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Definitions

- A **read endpoint** is a declared read of a projection, or a declared
  collection-returning service query. It names an input and a result contract,
  not an HTTP route or a new context member.
- A **collection result** is a variable-length collection selected by a read,
  including one inside a returned value. Arrays, sets, and maps used as
  collections follow the same bounds; changing the container does not escape
  them. Fixed-shape tuples are not paged collections.
- A **page** contains a bounded ordered list of items and a continuation cursor,
  or no continuation when the read found no further matching items.
- A **cursor** is an opaque data value locating the boundary after the last
  returned item for one endpoint and read selection.
- A **nested collection** is a collection inside a selected item or keyed
  result. Its depth counts collection levels below that result's outer
  collection, or below a keyed result with no outer collection; the first
  nested collection has depth one.
- **Full traversal** repeatedly reads pages until a collection is exhausted,
  rather than performing a fixed, bounded selection of pages.
- A **query policy** supplies numeric read limits. A **traversal capability**
  belongs to a mode kind; it is not a numeric policy override.

## Axioms

- Reads do not change domain state or the outside world.
- Projection data can lag behind saved aggregate state and can change between
  reads. A cursor is not a snapshot or an authorization grant.
- A process runs exactly one selected mode. Calling a manager or running a
  reactor in process does not change that mode.
- A finite item count bounds collection cardinality, not the size of arbitrary
  scalar data, database work, or elapsed time.

## Constraints

### Declared access

- Projection collection reads MUST use named endpoints declared with their
  projection. Keyed reads MUST also obey the policy for any collections in
  their selected result. A projection's stored shape is not automatically its
  public read shape.
- An endpoint MUST declare its input shape, selected result shape, and collection
  boundaries, with a stable item key for each selected collection. It MAY
  declare filter inputs and named sort orders; only those filters and orders
  are available to callers.
- Filters MUST be pure, with shaped data inputs, and MUST be applied before
  paging. Callers MUST NOT supply executable predicates, arbitrary field paths,
  or an undeclared query language.
- Each selected collection MUST have a deterministic total order, including a
  stable unique item key as a tie-breaker. Its declaration MUST specify the
  ordering of allowed key types and special values; host identity or unspecified
  database collation MUST NOT decide page boundaries.
- Undeclared filters or sorts, invalid shapes, and invalid page sizes MUST be
  refused before the read performs work. A page size MUST be a positive integer
  no greater than the endpoint's effective maximum. It MUST NOT be silently
  clamped.
- Permission to read a projection or call a service MUST remain governed by
  existing context and caller capabilities. Declaring an endpoint MUST NOT
  give jobs or consumers direct projection access, or external-event reactors
  direct service access.

### Defaults and overrides

Coleslaw MUST provide these built-in numeric defaults:

| Setting | Default |
| --- | --- |
| Outer page size | 10 |
| Maximum outer page size | 100 |
| Nested page size | 3 |
| Maximum nested page size | 10 |
| Maximum nested collection depth | 1 |

- A program MAY override the built-in query policy. Config MAY override the
  program policy. A read endpoint MAY further override its read limits.
  Precedence MUST be applied per setting: built-in, program, config, endpoint.
  An omitted setting MUST inherit the preceding value, not reset the policy.
- Caller-supplied page sizes MUST remain within the resulting endpoint limits.
  Callers MUST NOT override maximums, depth, or the API read-step budget.
- All effective sizes and read-step budgets MUST be finite positive integers;
  depth MUST be a finite nonnegative integer. Default page sizes MUST NOT
  exceed their respective maximums. Infinity or an unbounded alternative
  MUST NOT be accepted, even in a background mode.
- Endpoint overrides MUST be declaration data, not expressions computed from
  individual requests. Changing numeric limits MUST NOT grant traversal.
- The API read-step budget MUST be resolved once for the request using built-in,
  program, and config policy. Endpoint overrides MUST NOT reset or increase
  that shared budget. Its built-in numeric default remains an open question;
  this chapter does not choose a count.
- Invalid declaration limits MUST be compile errors. Invalid effective policy
  after config overrides MUST stop startup before serving work, naming the
  endpoint or setting and the violated constraint.
- Filtering and sorting MUST remain opt-in per endpoint. A global limit policy
  MUST NOT enable filters or sorts on every endpoint.

### Nested results

- Every selected variable-length collection MUST be bounded and paged, including
  collections reached by a keyed read. Its output MUST carry its own
  continuation information; silently truncating a stored collection is not
  paging.
- Each nested collection MUST use the nested default and maximum. A caller MAY
  request a smaller or larger nested page within that maximum when the endpoint
  declares that input.
- An endpoint MUST declare the selected collection paths. Selection exceeding
  the effective depth MUST be refused, not silently flattened or omitted.
  Recursive stored shapes MUST NOT imply recursive read expansion.
- A nested cursor MUST bind its parent item's or keyed result's stable identity
  and collection path as well as the endpoint and selection. It MUST NOT be
  reused for a different parent or path. Continuing a nested page MUST NOT
  reread or expand every sibling collection.
- With the built-in limits, an outer page contains at most 100 items and each
  declared nested collection at most 10 items per parent. Multiple declared
  collection paths add to that bound; it is not a promise of at most 1,000
  items for the entire response.
- An endpoint result shape MUST account for page envelopes and any selected
  scalar fields. Collection paging MUST NOT silently change the stored
  projection's shape or delete retained modeled error occurrences.

### Mode capability

| Built-in mode kind | Full traversal |
| --- | --- |
| API | Forbidden |
| Worker | Permitted |
| Job | Permitted |
| Events | Permitted |

- Full traversal support MUST be fixed by the mode kind's design. It MUST NOT
  be enabled by config, an endpoint override, a caller flag, or the type of
  declaration performing the read.
- An extension-defined mode kind MUST explicitly declare its traversal
  capability. An unspecified capability MUST NOT grant full traversal.
- API mode MUST forbid full traversal throughout its reachable call paths,
  including manager operations and in-process reactors. A reactor needing
  full traversal MUST run in a supporting mode, such as Events, not in process
  in API mode.
- The compiler MUST reject an API mode reaching declared traversal or a loop
  that follows continuation cursors until exhaustion, naming the mode and
  offending call path. Shared declarations MAY be used in several supporting
  modes; their capability MUST NOT follow them into API mode.
- API requests MAY perform a fixed, bounded number of reads. Every projection
  read and service query step MUST count against one shared request budget,
  including reads through managers, nested-page continuations, and synchronous
  in-process reactions. Invoking another manager MUST NOT reset the budget.
- When the request budget is exhausted, the runtime MUST stop further read
  steps and fail the invocation explicitly. It MUST NOT return a partial scan
  as a successfully completed operation.
- An in-process reaction running independently of a request in API mode MUST
  also have a finite API read-step budget for its invocation and MUST NOT
  perform full traversal. Asynchronous execution MUST NOT grant a background
  mode's capability.
- A supporting mode MAY traverse all pages, directly where allowed or through
  managers. Each page MUST still obey all effective read limits. Traversal
  MUST NOT accumulate an unbounded collection into one read or manager result.
  Programs MAY process successive pages without returning the whole collection.
- Traversal MUST respect mode stopping and delivery ownership rules. Permitting
  it MUST NOT extend a message lease, undo already committed commands, or
  promise that a live changing collection will eventually be exhausted.

## Mechanism

### Reading a page

- A page result MUST expose `items`, an ordered array matching the endpoint's
  item shape, and `next`, an opaque cursor or `null`. Projection reads MUST
  also preserve their ordinary reflected-version information.
- The first read MUST select up to its requested or default size in declared
  order. A continuation MUST select matching items strictly after the cursor's
  saved ordering boundary, evaluated against the data visible to that read.
- If a read found more matching items beyond its page, `next` MUST be a
  continuation, not `null`. An unchanged collection MUST NOT produce an empty
  nonterminal page or a cursor that fails to advance its ordering boundary.
- With unchanged data and selection, walking the cursor chain MUST return
  every matching item once in order, with a terminal `next` of `null`.
  Empty collections MUST return empty `items` and `next: null`.
- A cursor MUST remain usable if the item at its boundary is deleted; locating
  that boundary MUST NOT require the item's continued existence.
- The cursor MUST bind the endpoint and its contract revision, effective
  filter values, selected fields and collection paths, sort order, and access
  scope. Continuing with a different selection or incompatible revision MUST
  be refused explicitly. Page size MAY change within the effective limits.
- Every continuation MUST reapply authorization and context boundaries.
  Cursor contents MUST NOT grant access to data the current caller cannot read.
  An implementation MUST prevent cursor modification from bypassing those
  constraints and MUST NOT expose secrets in cursor contents or diagnostics.
- Malformed, incompatible, or expired cursors MUST produce an explicit refusal,
  never silently restart at the first page. An implementation imposing expiry
  MUST document it.
- A page MUST NOT claim to be a snapshot. Inserts before its saved boundary
  may be missed; moving items across the boundary may cause omissions or
  repeats. Deletions may remove items that appeared on an earlier page.
- A terminal cursor describes the read that produced it, not a guarantee that
  no matching item can appear later. A live traversal is not an exactly-once
  export or a reliable substitute for event or queue delivery.

### Composition and failures

- Projection endpoints MUST compute selected data from projections, never
  access aggregate storage directly or reconstruct it from events.
- Collection-returning service queries MUST declare and honor the same page
  and selection contract. Their implementation MAY use a provider's native
  cursor but MUST validate its binding and result bounds at the service edge.
  Fetching an unlimited provider result and slicing it in a manager MUST NOT
  satisfy a bounded read contract.
- The runtime MUST validate returned item shapes, page sizes, selected nested
  depth, item-key uniqueness and ordering within each page, and continuation
  structure before exposing a result. An implementation that violates its
  declared contract MUST fail the read with a diagnostic naming the endpoint
  and failing constraint; it MUST NOT silently slice or repair the result.
- Invalid external read input MUST be refused. Invalid read arguments computed
  internally, or a failed implementation, MUST fail the invoking operation;
  they MUST NOT be disguised as an empty page or a domain rejection.
- A failed read after an accepted command MUST preserve the warning that the
  command and its messages stand. Unknown commit warnings MUST also survive
  read-budget or continuation failures.
- Controller responses MUST carry the declared page result, including
  continuation metadata. Authorization and normal response-shape checks still
  apply; a cursor MUST NOT enable a route to bypass them.
- Runtime projection rebuilding MAY read every stored state through its own
  storage interface. It is maintenance work, not a program read endpoint, and
  MUST NOT expose an unrestricted storage scan to API code.

### Examples of limits and composition

| Situation | Required behavior |
| --- | --- |
| No policy overrides or requested sizes | Up to 10 outer items; up to 3 items per selected nested collection |
| Request outer size 100 under built-in policy | Accepted within the maximum |
| Request outer size 101 under built-in policy | Refused, not clamped to 100 |
| Select a collection inside another nested collection under built-in policy | Refused: depth two exceeds one |
| Program outer default 20, config default 15, endpoint default 8 | Use 8, inheriting other limits per setting |
| Endpoint maximum 5 with inherited outer default 10 | Invalid effective policy; do not silently lower the default |
| API route invokes successive managers to drain pages | Forbidden; changing caller does not change mode |
| In-process reactor in API mode attempts a full scan | Forbidden even if invoked asynchronously |
| Worker manager traverses pages | Permitted; page and nested limits still apply |
| Later page sees a newly inserted item before its cursor boundary | The item may be omitted; no snapshot guarantee |

## Why this design

- **Mode, not caller.** The same manager can serve API requests and background
  work. A consumer or reactor label cannot justify an unlimited scan when that
  work actually runs in API mode.
- **Small defaults, explicit expansion.** Ten outer items and three nested
  items make ordinary reads small. Named endpoints expose only useful filtering
  and sorting, rather than turning every projection into a query engine.
- **Cursor rather than offset.** A saved ordering boundary survives deletion
  of earlier items without making the next page shift merely because its
  offset changed. Live pages still need an explicit consistency limitation.
- **Separate cardinality and latency.** Small results favor good performance,
  but a selective query can still scan an expensive store. Numeric page limits
  cannot honestly promise a response time or bounded scalar payload size.

## Open questions

- **Performance monitoring and enforcement.** Queries taking over 100 ms are
  a warning sign; over one second is a red flag and outside the performance
  goal. Measuring, reporting, enforcing deadlines, cancellation, and total
  response time belong to cross-cutting concerns, not a hard-coded one-second
  ceiling in this chapter.
- **Byte and execution budgets.** Scalar sizes, cursor sizes, filter complexity,
  indexes, storage work, and total response bytes need additional bounds.
  Paging alone does not guarantee bounded database cost or payload bytes.
- **API read-step count.** The built-in numeric default of the shared API
  budget remains undecided. A finite request-level bound is required; neither
  that number nor a deadline is inferred from the page size.
- **Stable exports.** Snapshot reads, retention, and checkpoints for a stable
  background export are not provided by live cursor traversal.
- **Syntax.** Exact spelling of endpoint declarations, query policy overrides,
  page shapes, nested selections, ordering rules, and traversal.
