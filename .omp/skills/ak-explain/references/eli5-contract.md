# ELI5 Mode Contract (`--eli5`)

"Explain like I'm 5" (ELI5) simplifies the vocabulary, structure, and cognitive load of an explanation without lowering technical accuracy, omitting prerequisites, or erasing safety warnings.

## Core Rules

1. **Lead with Purpose & Gist**
   - Start with a direct 1–2 sentence answer answering "what does this do and why do I care?" using common language.

2. **Use One Familiar Everyday Analogy**
   - Anchor the explanation in a relatable physical or daily concept (e.g., postal system, restaurant kitchen, traffic light, library shelf, assembly line).
   - Use at most one primary analogy per main concept. Stacking multiple unrelated metaphors creates confusion.

3. **Explicitly Map the Analogy to the Real System**
   - Provide a clear mapping breakdown:
     - "In this analogy, the Chef is the Backend Server..."
     - "The Waiter is the API Request..."
     - "The Order Ticket is the JSON Payload..."

4. **Define Essential Technical Terms on First Use**
   - When precision requires retaining a technical term or code identifier, introduce it immediately with a simple definition:
     - *Format:* `SpecificTerm (plain English meaning)`
   - Spell out every acronym on first use.

5. **State Where the Analogy Stops Matching Reality**
   - When an analogy could lead to incorrect operational assumptions (e.g., assuming network calls are instantaneous or queues never fill up), explicitly state the boundary:
     - *"Where this analogy stops: unlike a real kitchen, computers can handle thousands of tickets simultaneously, but if the database crashes, all pending tickets are lost."*

6. **Preserve All Warnings, Invariants & Uncertainty**
   - **Never dilute safety warnings:** Security vulnerabilities, data-loss risks, financial/legal impacts, and irreversible commands must remain prominent and unambiguous.
   - Explain the *consequence* of the warning in plain terms (e.g., "If you delete this key, all users will be logged out immediately and their unsaved work will disappear").
   - Retain exact commands, error codes, and identifiers where changing them would make the advice unusable.

7. **Tone & Style Standards**
   - Use short sentences and active verbs.
   - Respectful, adult-neutral tone. **Never use baby talk**, condescending speech, or fake childish certainty.
   - Avoid filler adverbs ("obviously", "simply", "just").

## Example Structure

```markdown
### In a Nutshell
[1-2 sentence direct explanation]

### The Analogy: [Everyday Concept]
[Describe the everyday scenario]
- **[Real Component 1]** is like the **[Analogy Part 1]** because...
- **[Real Component 2]** is like the **[Analogy Part 2]** because...

### How It Works (Step by Step)
1. **[Step 1]**: [Action]
2. **[Step 2]**: [Action]
3. **[Step 3]**: [Action]

### Important Caveats & Where the Metaphor Ends
- ⚠️ **Warning**: [Retained technical warning and exact consequence]
- **Boundary**: [Where the analogy diverges from physical reality]
```
