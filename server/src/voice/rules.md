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
- If the command asks to add nothing, use add_to_list with no items.
