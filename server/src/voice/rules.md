# Voice rules

These rules decide which action a spoken command becomes and how its fields are filled in. Every
command is answered with exactly one action. Each rule here has lines in the phrase table of
`npm run voice:check`; change both together.

## Shopping lists: add_to_list

- Something to buy, or "add X" that means nothing else, goes on a shopping list.
- Match the list by meaning, not spelling: "M&S", "marks and spencer" and "marks and sparks" all
  name "M&S – Bangor", and "sainsburys" names "Sainsbury's – Bangor". "The shopping list", or no
  list at all, means no particular list.
- Write each item as a short list entry with its first letter capitalised ("Semi-skimmed milk").
- Keep a dish or product that contains "and" together ("Fish and chips", "Salt and vinegar
  crisps"), and split separate things ("eggs and milk" is "Eggs" and "Milk").
- Keep quantities and sizes that were said ("6 eggs", "Large bin bags"). Drop filler such as
  "some", "please" and "can you".
- A shop's name inside an item is part of the item: "tesco value beans" to M&S is the item
  "Tesco value beans" on M&S.
- Fix an obvious mishearing only when the intended item is clear.
- If a command plainly about shopping names nothing to add ("add to the Tesco list"), use
  add_to_list with no items.

## The diary: create_log

- An appointment is something booked for a day or a time: the dentist, a doctor's appointment, a
  haircut, an MOT, a meeting, a delivery. "Dentist next Tuesday at 3" is an appointment, never a
  shopping item. Its category is appointment.
- The title is what it is, short, with its first letter capitalised: "Dentist", "Haircut",
  "Car MOT". Leave out the date and time words.
- Work out the exact date from today in the context. Look days up in its comingDays list rather
  than counting:
  - "today", "tomorrow", "the day after tomorrow" are what they say.
  - A weekday on its own, "on Friday" and "this Friday" mean the first Friday in comingDays.
  - "Next Friday" means the Friday of next week, the week (Monday to Sunday) after this one: on a
    Monday, "next Tuesday" is eight days away, not tomorrow. Next week starts at the first Monday
    in comingDays.
  - "A week on Friday" is the second Friday in comingDays.
  - "The 14th" means the next 14th on or after today; "the 14th of March" the next 14 March on or
    after today.
- Time: an hour said without am or pm is in the daytime: 1 to 7 is the afternoon ("at 3" is 15:00),
  8 to 11 the morning, 12 is noon. "Half 3" is 15:30, "quarter past 9" 09:15, "quarter to 4"
  15:45. No time said means null.
- autoDelete: null, unless they ask to keep it as a record, then false.
- Anything else worth keeping goes in notes ("bring the letter"); otherwise null.

## Hang-outs and eating out: create_log

- A meal out with or without someone (breakfast, brunch, lunch, dinner, a meal, a takeaway eaten
  out) is eating_out, and its title is the place ("Dylan's", "Wetherspoons"). If no place was
  said, the title is the meal ("Dinner").
- Seeing people for anything else (drinks, coffee, a walk, bowling, the cinema, a party) is a
  hang_out, and its title is the activity, short: "Drinks", "Coffee", "Bowling".
- These can be in the past ("yesterday", "last night") as well as planned. "Tonight" and "this
  morning" are today.
- people: everyone it was with. Match each name by meaning to the context's people: "Zo" is
  "Zoe", "Mo" is "Mo Salah". Use their id. Someone who isn't in the list gets a null id and the
  name as said; never guess an id for them.

## Important dates: add_important_date

- A date that comes round every year for someone: "Ada's birthday is the 3rd of March", "Zoe
  and Tom's anniversary is 12 June", "Mo started his new job on 1 September".
- personId is the person it belongs to, matched by meaning to the context's people as for
  create_log; null if they aren't there. For a couple, use the first person named.
- tag says what the date is, short and capitalised: "Birthday", "Anniversary", "New job".
- month and day as said; year only if a year was said, otherwise null. "The 3rd" with no month
  means the month it next falls in, from today.
- Something that happens once (a party, a meal, an appointment) is create_log, not this.

## Anything else: not_supported

- Questions ("what's on tomorrow?", "what's on my list?"), removing or changing something, and
  anything no other action can do are not_supported, with a few words saying what was asked.
  Never put a question or a request like that on the shopping list.
