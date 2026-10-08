# Controllers

This chapter defines controllers: the entry points of API mode, by which the
outside world invokes managers and reads projections over HTTP. It covers
declaring a controller, the protocol it assumes, routes and binding a request to
them, what a route does, the responses it gives, authentication, authorization,
middleware, and the server that runs them. Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring a controller

- A controller declaration MUST name the controller and declare its routes, and
  MAY declare a pipeline of middleware for all of them (see
  [middleware](#middleware)).
- A controller MAY declare a path prefix, such as `/approvals`, which every one
  of its routes' paths begins with.
- A controller is a member of a context, and of at most one (see
  [modules](./modules.spec.md#declaring-a-context)). A mode reaches it through
  its context, and only if the context exports it (see
  [modules](./modules.spec.md#the-boundary)).
- A controller MUST be listed only by API modes. It MAY be listed by more than
  one, such as a public API mode and an administrative one (see
  [modes](./modes.spec.md#declaring-modes)).

## What a controller may use

A controller translates requests into the domain's terms and the domain's
results back into responses. It holds no business logic of its own.

- A controller MUST change the domain only by invoking the operations of
  managers. It MUST NOT send commands to aggregates, and MUST NOT call a
  service's operations, other than as an [authentication](#authentication) step
  the runtime performs for it.
- A controller MAY read projections directly.
- A controller MUST NOT read an aggregate's stored state. It reads what it needs
  from projections, as a manager does.
- A controller MAY use only the managers of its own context, since a context
  does not export its managers, and the projections of its own context or those
  another context exports.

## The protocol

Controllers assume HTTP. HTTP's semantics, its methods, targets, status codes,
header fields, and content, are the shared vocabulary of the web, and naming
them names no technology.

- Controllers MUST assume HTTP semantics as RFC 9110 defines them, and nothing
  more specific: not a version of HTTP, a server, a framework, a port, or
  transport security. Those belong to the [server](#the-server).
- A controller MUST NOT name any technology beyond HTTP semantics, such as a
  particular server, identity provider, or gateway.
- Other protocols, such as gRPC or a message stream over a socket, are not
  served by controllers. Serving one would be a different kind of entry point,
  in a kind of mode an extension adds (see [modes](./modes.spec.md#kinds)).

## Routes

- A route MUST declare an HTTP method and a path pattern, such as
  `GET /approvals/{id}`. A path pattern consists of literal segments and named
  parameters.
- Each path parameter MUST have a shape, which its segment, a string, must
  match. A segment that does not match its parameter's shape means the route
  does not match the request.
- Within a mode, routes MUST be tried in order: its controllers in the order the
  mode lists them, and each controller's routes in the order it declares them.
  The first route whose method and path match handles the request.
- A request whose path matches no route MUST be answered with status `404`. A
  request whose path matches routes, none of them for its method, MUST be
  answered with status `405`, listing the methods that would match.
- A route's path and method decide only which route handles a request. Every
  other part of the request is bound after the route is chosen (see
  [binding a request](#binding-a-request)).

## Binding a request

A request arrives from outside the program, so each part of it is matched
against a shape, as every input is (see
[patterns as types](./patterns-as-types.spec.md#shapes)).

- A route MAY declare a shape for each of these parts of a request:
  - **Path**: an object of the path parameters' values, each matched against its
    parameter's shape.
  - **Query string**: an object of the target's query parameters, each value a
    string, or an array of strings when the parameter is repeated.
  - **Headers**: the header fields the route names, each with its own shape.
  - **Body**: the request's content.
- A route that declares no shape for the query string or the body MUST refuse a
  request that has one.
- Object shapes for the path, the query string, and the body MUST be closed (see
  [patterns as types](./patterns-as-types.spec.md#closed-objects)), so an
  undeclared query parameter or body key is refused rather than ignored.
- Header fields are bound by name rather than as one closed object, because
  intermediaries add header fields a program cannot know of. A header field the
  route does not name MUST NOT be visible to the route. Header field names MUST
  be compared without regard to case, as HTTP compares them.
- Values in the path, the query string, and headers arrive as strings. Their
  shapes parse them, as config's shapes do (see
  [config](./config.spec.md#parsing-input-into-config)); for example a `limit`
  query parameter's shape matches a string of digits, projects the number, and
  supplies a default when the parameter is missing.
- A body MUST be accepted as JSON, with the media type `application/json`. A
  request whose body has a media type the route does not accept MUST be answered
  with status `415`, and one whose body cannot be decoded with status `400`.
- Every bound part MUST be data (see
  [patterns as types](./patterns-as-types.spec.md#data)).
- A request that does not match its route's shapes is a client error, not a
  defect. It MUST be refused with status `400` and an
  [error body](#error-bodies) naming the part, the path within it to what
  failed, and what was expected. The route does no work.

## What a route does

A route binds a request to one manager operation or one projection read, and
turns the result into a response. In the common case it needs no machine:

- A route MAY be declared as a manager operation and that operation's input,
  computed by expressions from the bound request and the principal.
- A route MAY be declared as a projection and the key to read, computed the same
  way, or as a read of a set of the projection's values (see [sets](#sets)).
- Expressions in a route MUST be able to refer to the bound request as
  `request`, with its parts `path`, `query`, `headers`, and `body`, and to the
  principal as `principal` when the route is authenticated (see
  [authentication](#authentication)), besides what every expression may refer to
  (see [expressions](./expressions.spec.md#scope)).
- A route MUST NOT pass the request, or any part of it, to a manager except
  through the operation's input. A manager never sees the request or the
  principal except as its input carries them.

## Route state machines

A route that needs more than binding, such as reading a projection to find the
identity an operation needs, runs a state machine, as a manager's operation
does. Like an operation's, it lives for one request and is never stored.

- A route state machine MUST have exactly one start state, which receives the
  bound request and the principal.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the request.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - invoke a manager operation;
  - read a projection;
  - or none, to choose the next state from the variables alone.
- A step's arguments MUST be computed by expressions from the bound request, the
  principal, and the variables.
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state. A result no handler matches MUST end the request as failed,
  naming the state and the result.
- A final state MUST give the route's response (see [responses](#responses)),
  computed by expressions from the bound request, the principal, and the
  variables.
- A route MUST invoke at most one manager operation per request. The compiler
  MUST reject a route state machine in which any path from the start state
  passes through two states that invoke an operation, or through one such state
  twice. Work across aggregates is done by reactors, not by a request.
- Given the same request, principal, and step results, a route MUST take the
  same path and give the same response. Its only variation is the request and
  what its steps return.

## Responses

A manager operation ends in one of five results (see
[managers](./managers.spec.md#results)). A route turns its result into an HTTP
response.

- By default, a route invoking an operation MUST respond as follows:

  | Result     | Status | Body                                  |
  | ---------- | ------ | ------------------------------------- |
  | Completed  | `200`  | The result value                      |
  | Refused    | `400`  | An error body naming what failed      |
  | Rejected   | `422`  | An error body carrying the reason     |
  | Conflicted | `409`  | An error body                         |
  | Failed     | `500`  | An error body with no internal detail |

- A completed result whose value is `undefined` MUST be answered with status
  `204` and no body.
- A route MAY declare a different successful status, such as `201` or `202`, and
  MAY compute response header fields and the response body from the result by
  expressions, such as a `Location` header naming a created resource.
- A route MAY map rejections to other `4xx` statuses by patterns over the
  reason, such as `404` for a reason saying the aggregate does not exist, or
  `403` for one saying the principal may not act on it. Patterns choose the
  status; they decide nothing.
- A route MUST NOT answer a result other than completed with a `2xx` status, and
  MUST NOT change the status of a conflicted or failed result.
- A route reading a projection by key MUST respond `200` with the value, or
  `404` when the projection holds no value for the key.
- A route MAY declare a shape for its response body. A body that does not match
  it MUST end the request as failed, as an operation's result that does not
  match its result shape does.
- A response body MUST be data, encoded as JSON with the media type
  `application/json`.

## Error bodies

Every client should read every error the same way, whichever controller, route,
or step produced it.

- Every error response a controller or the runtime gives, including a route not
  found, a refusal, a rejection, a conflict, a failure, and a response an
  authentication or authorization step gives, MUST use one standard body format.
  The planned `problems` chapter defines that format as RFC 9457 problem
  details, with the media type `application/problem+json`.
- A rejection's error body MUST carry its reason, which is data the domain chose
  to report.
- A failure's error body MUST NOT carry the error, a stack trace, a secret, or
  any other detail of the defect. The failure MUST be reported by the runtime,
  naming the route and the error, as other failures are.

## Sets

- A route that reads a set of values, such as the approvals awaiting the
  principal, MUST be paged and limited, so that no request returns an unbounded
  set. Paging, limits, sorting, and filtering are defined by the planned
  `queries` chapter.
- A route MUST NOT iterate over a whole collection while serving a request.

## Authentication

Authentication establishes who is making a request. Coleslaw does not choose
how: the program declares a service whose implementation, chosen by config,
recognizes credentials, such as an OpenID Connect provider's tokens, a session
cookie, or a webhook's signature.

- Authentication MUST be performed by an authentication step in a route's
  pipeline (see [middleware](#middleware)), naming a query of a service
  declaration. The runtime calls the query; the controller never calls it.
- The query's input shape MUST be matched against the request's credentials: its
  method, its path, and the header fields its shape names. Its output shape MUST
  distinguish a principal from the absence of one, as alternatives.
- A principal MUST be data, matching the shape the query's output gives it. It
  is available to the route's expressions and authorization rules as
  `principal`.
- An authentication step MAY name several queries, tried in order. The first to
  give a principal establishes it, and a request for which none does MUST be
  answered with status `401` and an [error body](#error-bodies).
- A route's pipeline MUST have at most one authentication step, so a request has
  at most one principal.
- Every route MUST either have an authentication step in its pipeline or be
  declared public. A route that has neither MUST be a compile error, so a route
  is never anonymous by omission.
- A public route MUST NOT refer to `principal`.
- An authentication query that fails, as a service call fails (see
  [services](./services.spec.md#failure)), MUST end the request as failed. A
  missing or invalid credential is not a failure: it is the absence of a
  principal.

## Authorization

Authorization decides whether a principal may invoke a route. It is decided by
patterns, which are pure, before any manager is invoked or projection read.

- An authorization rule MUST be a pattern, matched against an object of the
  principal and the bound request, such as one requiring the principal's roles
  to include `approver`. A rule MAY be declared by name and used by many routes.
- An authorization step names one or more rules, all of which MUST match.
- A request whose principal and request do not match a rule MUST be answered
  with status `403` and an [error body](#error-bodies), and the route does no
  work.
- Authorization rules MUST be evaluated after the request is bound and before
  the route invokes an operation or reads a projection.
- A rule that depends on the domain's state, such as whether this principal is a
  required approver of this deployment, is a business rule. The aggregate
  decides it, rejecting the command, and the route MAY map that rejection to
  `403` (see [responses](#responses)).
- Scoping requests to a tenant is defined by the planned `tenancy` chapter.

## Middleware

Middleware is the steps that run around a controller's routes. A pipeline is
composed of steps and other pipelines; nothing in it is inherited, overridden,
or removed.

- A pipeline MUST be an ordered list of steps and named pipelines. A named
  pipeline MAY be declared on its own and listed by many controllers, routes,
  and other pipelines.
- A step MUST be one of:
  - an authentication step (see [authentication](#authentication));
  - an authorization step (see [authorization](#authorization));
  - a step an extension provides, such as correlating requests with the commands
    and events they cause, auditing, tracing, request logging, or rate limiting
    (see the planned `extensions` chapter).
- A route's pipeline MUST be its controller's pipeline followed by any steps and
  pipelines the route lists. Steps run in order, the first outermost, and the
  route's work runs inside the last.
- A route MUST NOT remove, replace, or reorder a step of a pipeline it includes.
  A route that needs a different pipeline lists a different composition.
- A step MAY end the request with a response, such as `401` or `403`, and then
  no step inside it and no route work runs.
- The request MUST be bound after the pipeline's authentication step has run and
  before its first authorization step, so a client without credentials is
  answered `401` before its request's shape is examined. An authorization step
  listed before the authentication step MUST be a compile error.
- Middleware MUST NOT invoke managers, read projections, or carry business
  logic. A step gives the route nothing but what its kind defines: an
  authentication step gives the principal, and an extension's step gives only
  what the extensions chapter allows.
- Handling a defect, answering a request no route matches, and answering a
  refusal are the runtime's, not steps a program declares.

## The server

The server that accepts connections and speaks HTTP is not part of the program.

- The server MUST be a service the runtime itself needs in API mode, as
  aggregate state storage is: never declared or called by the program, and
  implemented for a technology the config chooses (see
  [startup](./startup.spec.md#services)).
- Coleslaw MUST provide an implementation of the server, so an API mode runs
  with no technology chosen.
- What a server needs to listen, such as an address and a port, MUST be settings
  of its implementation, part of the config under the server's settings.
- A checker or a test MAY replace the server with an implementation that
  delivers chosen requests directly, since the request is a source of variation
  at the program's edge (see the overview's
  [checkability](./overview.spec.md#checkability)).
- When an API mode is stopped, the server MUST stop taking new requests (see
  [modes](./modes.spec.md#stopping)). A request abandoned before its operation's
  command is saved changed nothing.

## Open questions

- **Other media types.** Whether a route may accept bodies other than JSON, such
  as forms or multipart uploads, and respond with content other than JSON, such
  as files.
- **Raw bodies.** A webhook's signature is computed over the body's exact bytes.
  How an authentication query receives them, without making raw bytes part of
  every route's binding.
- **Encoding data as JSON.** Data includes values JSON cannot represent, such as
  bigints, maps, sets, dates, and `undefined`. How a request body is decoded to
  them and a response body encodes them, so a client can read them back.
- **More than one operation.** Whether a route may ever invoke more than one
  operation, such as a batch endpoint, or whether such work must always go
  through a reactor.
- **Mode-wide middleware.** Whether a mode may declare a pipeline for every
  controller it runs, such as tracing, rather than each controller listing it.
- **Health and readiness.** How an API mode answers health and readiness checks,
  and whether they are routes, a server's concern, or an extension's.
- **Static content.** Whether a controller may serve static files, such as a
  site's assets or a domain-verification file, or whether these belong outside
  the program.
- **Cross-origin requests.** How a controller declares which origins may call
  it, and whether that is a step, a setting, or an extension.
- **Describing the API.** Whether the compiler should produce a description of
  each API mode's routes and shapes, such as an OpenAPI document, from the
  declarations.
- **Authorization by stored state.** Whether an authorization rule may read a
  projection, so a route can refuse a principal before invoking an operation,
  without that becoming business logic in a controller.
