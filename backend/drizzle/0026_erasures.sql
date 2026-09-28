CREATE TABLE "erasures" (
	"appeared_week" date PRIMARY KEY NOT NULL,
	"erased" integer NOT NULL,
	CONSTRAINT "erasures_erased_positive" CHECK ("erasures"."erased" > 0),
	CONSTRAINT "erasures_week_monday" CHECK (extract(isodow from "erasures"."appeared_week") = 1)
);
