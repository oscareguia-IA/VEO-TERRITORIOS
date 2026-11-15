-- VEO Territorios · georreferencia de fotografías
alter table public.veo_documents
  add column if not exists geo_lat        double precision check (geo_lat between -90 and 90),
  add column if not exists geo_lng        double precision check (geo_lng between -180 and 180),
  add column if not exists geo_source     text check (geo_source in ('exif','dispositivo')),
  add column if not exists geo_accuracy_m integer check (geo_accuracy_m between 0 and 100000),
  add column if not exists taken_at       timestamptz;
