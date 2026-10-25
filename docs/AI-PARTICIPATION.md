# AI-native participation: capability decision

Issue: [#34](https://github.com/cyrusjamula/family-hub/issues/34). Evidence checked 2026-10-25. **Discovery result, not a completed integration.**

The target is a member staying in their chosen AI to retrieve a shared task, contribute a proposal, retrieve an owner's decision and submit feedback. The Hub website is optional administration. Muse is excluded. A source search, generated draft or successful backend test does not prove this workflow.

## Capability matrix

| Entry point | Read shared context | Persist proposal/result | Identity, approvals and feedback | Plan/cost evidence | Live result |
| --- | --- | --- | --- | --- | --- |
| ChatGPT web with custom MCP plugin | Read tools documented [1] | Write tools documented [1] | OAuth supported; backend must bind verified member identity and enforce exact-action approvals. Feedback can be a narrowly scoped write tool; neither tool exists yet. | Documentation establishes protocol support, not this account's plan entitlement or hosting allowance. Check actual account. | No Hub MCP plugin/round trip verified. |
| Consumer Copilot with native Google/OneDrive connectors | Connected file/email/calendar retrieval documented [2] | Arbitrary Hub write/custom MCP support **not established** by the consumer connector page. Drafting text is not persistence. | Uses connected account access [2]; member mapping and backend task approvals remain unproven. No verified feedback write path. | Article applies to personal Microsoft accounts on listed Microsoft 365 plans; free-account availability must be checked in the actual client [2]. | No member round trip verified. |
| Consumer Copilot Cowork Preview | Authorized service/browser work documented [3] | File/email/calendar operations documented, but exact safe Hub operation untested [3] | Sensitive actions require review; website interactions can be performed by the assistant [3]. Backend still enforces member access. | Transition page says Preview execution requires Premium or Pro; Personal/Family execution access is lost after migration [4]. No upgrade authorized. | Conditional candidate only if already entitled and owner-authorized. |
| Copilot Workflows Frontier | Supported Microsoft services only [5] | Limited service actions; custom/non-Microsoft connectors unsupported [5] | Not evidence of a consumer arbitrary API bridge. | Frontier rollout/plan gating must be checked [5]. | Not selected for the Hub adapter. |

Consumer Copilot, Microsoft 365 organizational connectors, Windows experimental agents and GitHub Copilot are different surfaces. Evidence for one does not establish another. No general callable API for consumer Copilot conversations was established by this investigation. A supported native connector is not agent-to-agent dispatch.

## Smallest next proof

**Conditional go:** an authenticated, tools-only ChatGPT MCP transport to existing task/feedback services. First confirm the actual account can install it. Reuse the existing backend; do not build another daily website or expose anonymous family data. A publicly reachable transport may still require authentication for every data operation. Source resources stay Restricted.

**Hold the full cross-AI pilot:** free consumer Copilot write participation is unproven. Do not build its adapter on assumed API support. If an existing authorized Cowork entitlement is available, test whether it can operate the existing private workflow while the person stays in Copilot; this is assistant-driven browser interaction, not a direct API. If unavailable, the owner must choose an eligible supported AI, an approved existing paid entitlement, or defer this part. Do not silently substitute copy/paste, email relays, or daily website use.

## Bounded live trial and exit criteria

One focused validation session per intended client/account; stop on unavailable capability, login/consent wall, new cost, unsupported automation or uncertain identity.

1. Verify product surface, plan and visible connection capability privately. Record only sanitized pass/fail evidence publicly; authentication happens directly with the provider.
2. Use a synthetic shared task with a unique nonce and no real itinerary/personal data. Read its ID/version from inside the chosen AI.
3. Propose a harmless update through a supported write path. Verify its returned receipt and reread the durable state; never infer success from assistant prose.
4. Retrieve that same version from another authorized AI/member session. Test stale update, duplicate submission, unknown identity, revoked access and child-to-private denial with synthetic fixtures.
5. Test draft decision retrieval and private feedback receipt. Task approval must not authorize a message, booking, purchase or private disclosure. Do not send any external messages in this trial.
6. Record supported/blocked result, client, operation, observed outcome and remaining gate. No account-specific identifiers, screenshots, credentials or private content enter public evidence.

Go to adapter implementation only when the chosen transport has an actual read/write proof, member identity boundary and bounded cost. Otherwise keep #34 open with the exact missing capability. Contract drafting may proceed as transport-independent work, but does not clear this gate.

## Sources

1. [OpenAI: Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server) — read/write tools, web installation, OAuth, supported transports and confirmation behavior. This page does not prove account-specific availability.
2. [Microsoft: Connect Copilot to other services](https://support.microsoft.com/en-us/microsoft-copilot/connecting-microsoft-copilot-to-other-services) — consumer service list, retrieval, connected-account permissions and listed plan applicability.
3. [Microsoft: Get started with Cowork for personal accounts](https://support.microsoft.com/en-us/microsoft-365-copilot/get-started-with-cowork) — Preview, account setup, service operations and browser tasks.
4. [Microsoft: Copilot app updates](https://support.microsoft.com/en-us/microsoft-365-copilot/learning/changes-microsoft-copilot-app) — Tasks transition, Premium/Pro restriction and feature changes. Recheck during the trial because rollout is evolving.
5. [Microsoft: Workflows](https://support.microsoft.com/en-us/microsoft-365-copilot/get-started-with-workflows-in-microsoft-365-copilot) — Frontier access, supported service actions and connector limitations.
