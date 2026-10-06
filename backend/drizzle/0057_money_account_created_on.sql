-- The phone's day an account was made on (MOL-250): made on its own start day, it starts at the
-- moment it was made. Accounts made before this took the day of Yerevan — production is one person
-- in Gyumri, and every copy holds the same owner's data.
ALTER TABLE "money_accounts" ADD COLUMN "created_on" date;--> statement-breakpoint
UPDATE "money_accounts" SET "created_on" = ("created_at" at time zone 'Asia/Yerevan')::date;--> statement-breakpoint
ALTER TABLE "money_accounts" ALTER COLUMN "created_on" SET NOT NULL;
