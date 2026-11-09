-- MOL-361, адверсариальное А1, А2: уведомление о входе не удаляется при выдаче, а отмечается (`handed_at`) и
-- уходит по слову бота; не ушедшее — Telegram 429 того чата, сеть — возвращается с `not_before`, за спины
-- остальных. Без слова бота за аренду — отпускается, неотправленным: не больше одного раза.
ALTER TABLE "login_notices" ADD COLUMN "handed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_notices" ADD COLUMN "not_before" timestamp with time zone;