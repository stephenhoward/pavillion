import { Report } from '@/common/model/report';

export interface ReportCreatedPayload {
  report: Report;
}

export interface ReportVerifiedPayload {
  report: Report;
}

export interface ReportEscalatedPayload {
  report: Report;
  reason: string;
}

export interface ReportResolvedPayload {
  report: Report;
  reviewerId: string;
}
