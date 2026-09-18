-- The dhikr library's starting contents (docs/ADMIN.md §3.9).
--
-- Copied from the Tasbih Counts dhikr library (site/src/content/dhikr.ts), ids
-- and order included. The ids must match exactly: every count anyone has
-- recorded, in their browser and in counter_components, is stored under them.
--
-- The column is still called "devanagari" (the schema is shared with the Bhakti
-- Nam Jap build); here it holds the Arabic text.
--
-- Positions are spaced by ten so a dhikr can be moved between two others without
-- renumbering the rest.

insert into public.names (id, devanagari, transliteration, meaning, grp, position) values
  ('subhanallah', 'سُبْحَانَ ٱللَّٰهِ', 'SubhanAllah', 'Glory be to Allah.', null, 10),
  ('alhamdulillah', 'ٱلْحَمْدُ لِلَّٰهِ', 'Alhamdulillah', 'All praise is for Allah.', null, 20),
  ('allahu-akbar', 'ٱللَّٰهُ أَكْبَرُ', 'Allahu Akbar', 'Allah is the greatest.', null, 30),
  ('la-ilaha-illallah', 'لَا إِلَٰهَ إِلَّا ٱللَّٰهُ', 'La ilaha illallah', 'There is no god but Allah.', null, 40),
  ('astaghfirullah', 'أَسْتَغْفِرُ ٱللَّٰهَ', 'Astaghfirullah', 'I seek forgiveness from Allah.', null, 50),
  ('salawat', 'ٱللَّٰهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ', 'Allahumma salli ''ala Muhammad', 'O Allah, send blessings upon Muhammad.', 'mantra', 60),
  ('subhanallahi-wa-bihamdihi', 'سُبْحَانَ ٱللَّٰهِ وَبِحَمْدِهِ', 'SubhanAllahi wa bihamdihi', 'Glory be to Allah, and praise be to Him.', null, 70),
  ('subhanallahil-azeem', 'سُبْحَانَ ٱللَّٰهِ ٱلْعَظِيمِ', 'SubhanAllahil-''Azeem', 'Glory be to Allah, the Most Great.', null, 80),
  ('la-hawla', 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِٱللَّٰهِ', 'La hawla wa la quwwata illa billah', 'There is no power and no strength except by Allah.', null, 90),
  ('astaghfirullah-wa-atubu', 'أَسْتَغْفِرُ ٱللَّٰهَ وَأَتُوبُ إِلَيْهِ', 'Astaghfirullaha wa atubu ilayh', 'I seek forgiveness from Allah and turn to Him in repentance.', null, 100),
  ('hasbunallah', 'حَسْبُنَا ٱللَّٰهُ وَنِعْمَ ٱلْوَكِيلُ', 'Hasbunallahu wa ni''mal wakeel', 'Allah is sufficient for us, and He is the best disposer of affairs.', null, 110),
  ('dua-yunus', 'لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ ٱلظَّالِمِينَ', 'La ilaha illa anta subhanaka inni kuntu minaz-zalimeen', 'There is no god but You, glory be to You. Indeed, I was among the wrongdoers.', 'mantra', 120),
  ('afuwwun', 'ٱللَّٰهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ ٱلْعَفْوَ فَٱعْفُ عَنِّي', 'Allahumma innaka ''afuwwun tuhibbul-''afwa fa''fu ''anni', 'O Allah, You are Most Forgiving and You love forgiveness, so forgive me.', 'mantra', 130),
  ('talbiyah', 'لَبَّيْكَ ٱللَّٰهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ ٱلْحَمْدَ وَٱلنِّعْمَةَ لَكَ وَٱلْمُلْكَ، لَا شَرِيكَ لَكَ', 'Labbayka Allahumma labbayk, labbayka la sharika laka labbayk, innal-hamda wan-ni''mata laka wal-mulk, la sharika lak', 'Here I am, O Allah, here I am. Here I am, You have no partner, here I am. Indeed all praise and blessing are Yours, and the dominion. You have no partner.', 'mantra', 140)
on conflict (id) do nothing;
