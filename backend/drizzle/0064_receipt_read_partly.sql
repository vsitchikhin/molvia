-- Read in part, of the lines as read before the check emptied any (MOL-255, А6 «а»): the phone sees only
-- the lines shown, and says «Прочитали не всё» by this. A receipt read before keeps none: its lines were
-- shown as read, and the phone measures them itself, as before.
ALTER TABLE "receipts" ADD COLUMN "read_partly" boolean;