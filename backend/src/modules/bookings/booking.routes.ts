import { Router } from "express";
import { cancelBooking, createBooking, listBookings, quoteBooking } from "./booking.controller";

export const bookingRouter = Router();

bookingRouter.get("/bookings", listBookings);
bookingRouter.post("/bookings/quote", quoteBooking);
bookingRouter.post("/bookings", createBooking);
bookingRouter.post("/bookings/:id/cancel", cancelBooking);
