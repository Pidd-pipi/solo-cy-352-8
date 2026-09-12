import type { Request, Response } from "express";
import { asyncHandler } from "../../common/errors";
import { BookingService } from "./booking.service";

const service = new BookingService();

export const listBookings = asyncHandler(async (request: Request, response: Response) => {
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  response.json(await service.listBookings(status));
});

export const quoteBooking = asyncHandler(async (request: Request, response: Response) => {
  response.json(await service.quote(request.body ?? {}));
});

export const createBooking = asyncHandler(async (request: Request, response: Response) => {
  const booking = await service.createBooking(request.body ?? {});
  response.status(201).json(booking);
});

export const cancelBooking = asyncHandler(async (request: Request, response: Response) => {
  response.json(await service.cancelBooking(String(request.params.id)));
});
