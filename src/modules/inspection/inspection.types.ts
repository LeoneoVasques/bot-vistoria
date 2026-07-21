export type InspectionStatus = 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

export interface ActiveInspectionSession {
  plate: string;
  userPhone: string;
  status: InspectionStatus;
  startedAt: string;
  transcriptions: string[];
  images: string[];
}
