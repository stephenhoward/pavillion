import { Report } from '@/common/model/report';

export interface ReportCreatedPayload {
  report: Report;
  reporterEmail?: string;
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

export interface ReportAutoEscalatedPayload {
  report: Report;
  reason: string;
}

export interface ReportEscalationReminderPayload {
  report: Report;
}
