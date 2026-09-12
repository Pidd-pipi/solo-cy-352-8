import { API_BASE_URL } from "../constants/app";
import type {
  Booking,
  BookingQuote,
  Member,
  OverviewResponse,
  RechargeResult,
  Room,
  WalletTransaction,
} from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error("无法连接后端服务，请确认服务已启动");
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return body as T;
}

export function fetchOverview(): Promise<OverviewResponse> {
  return request<OverviewResponse>("/overview");
}

export function fetchRooms(): Promise<Room[]> {
  return request<Room[]>("/rooms");
}

export function fetchMembers(): Promise<Member[]> {
  return request<Member[]>("/members");
}

export function createMember(payload: { name: string; phone: string; level: string }): Promise<Member> {
  return request<Member>("/members", { method: "POST", body: JSON.stringify(payload) });
}

export function rechargeMember(memberId: string, amount: number): Promise<RechargeResult> {
  return request<RechargeResult>(`/members/${memberId}/recharge`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export function fetchMemberTransactions(memberId: string): Promise<WalletTransaction[]> {
  return request<WalletTransaction[]>(`/members/${memberId}/transactions`);
}

export function fetchBookings(): Promise<Booking[]> {
  return request<Booking[]>("/bookings");
}

export function quoteBooking(payload: {
  roomId: string;
  memberId: string;
  startTime: string;
  endTime: string;
}): Promise<BookingQuote> {
  return request<BookingQuote>("/bookings/quote", { method: "POST", body: JSON.stringify(payload) });
}

export function createBooking(payload: {
  roomId: string;
  memberId: string;
  startTime: string;
  endTime: string;
}): Promise<Booking> {
  return request<Booking>("/bookings", { method: "POST", body: JSON.stringify(payload) });
}

export function cancelBooking(bookingId: string): Promise<Booking> {
  return request<Booking>(`/bookings/${bookingId}/cancel`, { method: "POST" });
}
