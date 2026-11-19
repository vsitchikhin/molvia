-- MOL-421. Округление аптеки (А1 «а»): строки сошлись с итогом как напечатано, в тысячных, а в тетри расходятся на
-- тетри-другой — строка ревью «Округление», строки дают итог без него, поход — итог. Только добавление: откат образа
-- читает колонку как пустую.
ALTER TABLE "receipts" ADD COLUMN "rounding_minor" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_rounding_not_nought" CHECK ("receipts"."rounding_minor" is null or "receipts"."rounding_minor" <> 0);