import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "./common.js";
import type { NodeStatusResponse, PositionResponse, WindowsResponse } from "./mocks/ephemeris.js";
import type { TokenResponse, VerifyResponse } from "./mocks/identity.js";
import type { CompleteResponse } from "./mocks/oracle.js";
import type { AuthorizeRequest, PaymentResponse } from "./mocks/payments.js";
import type { DeliverRequest } from "./mocks/relay.js";
import type { HoldResponse as V1Hold, StartResponse as V1Start, StatusResponse as V1Status } from "./mocks/washer-v1.js";
import type { CycleResponse, HoldResponse as V2Hold } from "./mocks/washer-v2.js";
import type { AccountsService } from "./services/accounts/port.js";
import type { BillingService } from "./services/billing/port.js";
import type { DispatchService } from "./services/dispatch/port.js";
import type { NotifyService } from "./services/notify/port.js";
import type { OrdersService } from "./services/orders/port.js";
import type { SupportService } from "./services/support/port.js";
import type { TrackingService } from "./services/tracking/port.js";
import type { WashnodesService } from "./services/washnodes/port.js";

export interface PaymentsClient {
  authorize(req: AuthorizeRequest, ctx: Ctx): Promise<Result<PaymentResponse>>;
  capture(paymentRef: string, amount: number | undefined, ctx: Ctx): Promise<Result<PaymentResponse>>;
  refund(paymentRef: string, amount: number | undefined, ctx: Ctx): Promise<Result<PaymentResponse>>;
}

export interface EphemerisClient {
  windows(habitatId: string, ctx: Ctx): Promise<Result<WindowsResponse>>;
  position(shuttleId: string, ctx: Ctx): Promise<Result<PositionResponse>>;
  status(nodeId: string, ctx: Ctx): Promise<Result<NodeStatusResponse>>;
}

export interface IdentityClient {
  token(operatorId: string, key: string): Promise<Result<TokenResponse>>;
  verify(token: string): Promise<Result<VerifyResponse>>;
}

export interface WasherV1Client {
  hold(washer: string, ctx: Ctx): Promise<Result<V1Hold>>;
  status(washer: string, ctx: Ctx): Promise<Result<V1Status>>;
  start(washer: string, holdToken: string, ctx: Ctx): Promise<Result<V1Start>>;
  release(washer: string, holdToken: string, ctx: Ctx): Promise<Result<void>>;
}

export interface WasherV2Client {
  createHold(washerId: string, ctx: Ctx): Promise<Result<V2Hold>>;
  deleteHold(holdId: string, ctx: Ctx): Promise<Result<void>>;
  startCycle(holdId: string, callbackUrl: string, ctx: Ctx): Promise<Result<CycleResponse>>;
  cycle(cycleId: string, ctx: Ctx): Promise<Result<CycleResponse>>;
}

export interface RelayClient {
  deliver(req: DeliverRequest, ctx: Ctx): Promise<Result<{ deliveryId: string }>>;
}

export interface OracleClient {
  complete(prompt: string, maxTokens: number, ctx: Ctx): Promise<Result<CompleteResponse>>;
}

/** Every client a service may receive. A service uses only those its brief lists. */
export interface Clients {
  orders: OrdersService;
  dispatch: DispatchService;
  washnodes: WashnodesService;
  billing: BillingService;
  tracking: TrackingService;
  accounts: AccountsService;
  notify: NotifyService;
  support: SupportService;
  payments: PaymentsClient;
  ephemeris: EphemerisClient;
  identity: IdentityClient;
  washerV1: WasherV1Client;
  washerV2: WasherV2Client;
  relay: RelayClient;
  oracle: OracleClient;
}
