import type { Request, Response } from "express";
import { asyncHandler } from "../../common/errors";
import { MemberService } from "./member.service";

const service = new MemberService();

export const listMembers = asyncHandler(async (_request: Request, response: Response) => {
  response.json(await service.listMembers());
});

export const getMember = asyncHandler(async (request: Request, response: Response) => {
  response.json(await service.getMember(String(request.params.id)));
});

export const createMember = asyncHandler(async (request: Request, response: Response) => {
  const member = await service.createMember(request.body ?? {});
  response.status(201).json(member);
});

export const rechargeMember = asyncHandler(async (request: Request, response: Response) => {
  response.json(await service.recharge(String(request.params.id), request.body ?? {}));
});

export const listMemberTransactions = asyncHandler(async (request: Request, response: Response) => {
  response.json(await service.listTransactions(String(request.params.id)));
});
