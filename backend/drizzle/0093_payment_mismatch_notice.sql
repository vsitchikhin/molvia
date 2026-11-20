-- MOL-277. Уведомление владельцу о расхождении банка и журнала платежей (В-5 «а»): ещё один вид в списке. Только
-- расширяет проверку: откат образа читает старые виды как раньше.
ALTER TABLE "owner_notices" DROP CONSTRAINT "owner_notices_kind_known";--> statement-breakpoint
ALTER TABLE "owner_notices" ADD CONSTRAINT "owner_notices_kind_known" CHECK ("owner_notices"."kind" in ('failure', 'failure_count', 'failure_muted', 'feedback', 'feedback_continued', 'catalogue_merged', 'model_spend', 'model_share', 'receipt_partial', 'receipt_partial_muted', 'silence', 'payment_mismatch'));