export type InspectionStatus = 'EM_ANDAMENTO' | 'AGUARDANDO_SELECAO_TEMPLATE' | 'AGUARDANDO_DADOS_FALTANTES' | 'AGUARDANDO_APROVACAO' | 'CONCLUIDO' | 'CANCELADO';

export interface ActiveInspectionSession {
  plate: string;
  userPhone: string;
  officeTemplate?: string;
  status: InspectionStatus;
  startedAt: string;
  updatedAt?: string;
  transcriptions: string[];
  images: string[];
  lastExtractedData?: any;
  lastPdfPath?: string;
  missingFieldsPrompted?: boolean;
}
