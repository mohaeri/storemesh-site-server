ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS reprint_reason_code text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS default_printer_id uuid;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS selected_printer_id uuid;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS printer_override boolean NOT NULL DEFAULT false;

ALTER TABLE print_attempts DROP CONSTRAINT IF EXISTS print_attempts_reprint_reason_code_check;
ALTER TABLE print_attempts ADD CONSTRAINT print_attempts_reprint_reason_code_check CHECK (
  reprint_reason_code IS NULL OR reprint_reason_code IN (
    'PRINTER_ERROR', 'PAPER_FINISHED', 'RIBBON_FINISHED', 'DAMAGED_LABEL',
    'LOST_LABEL', 'POOR_PRINT_QUALITY', 'CUSTOMER_REQUEST', 'OTHER'
  )
);
