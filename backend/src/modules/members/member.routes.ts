import { Router } from "express";
import {
  createMember,
  getMember,
  listMembers,
  listMemberTransactions,
  rechargeMember,
} from "./member.controller";

export const memberRouter = Router();

memberRouter.get("/members", listMembers);
memberRouter.post("/members", createMember);
memberRouter.get("/members/:id", getMember);
memberRouter.post("/members/:id/recharge", rechargeMember);
memberRouter.get("/members/:id/transactions", listMemberTransactions);
