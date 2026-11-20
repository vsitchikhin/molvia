-- MOL-277. «У меня только карта РФ» (Р-8): нажатия по дням Еревана и из них — повтор того же устройства за сутки. Без
-- человека и без id. Только добавление: откат образа таблицу не читает.
CREATE TABLE "rf_card_days" (
	"day" date PRIMARY KEY NOT NULL,
	"taps" integer DEFAULT 0 NOT NULL,
	"again" integer DEFAULT 0 NOT NULL
);
