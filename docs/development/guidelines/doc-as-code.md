---
layout: default
title: Documentation as Code Concept - Leveraging AI
parent: Guidelines
---

# Documentation as Code Concept - Leveraging AI

## Core Concept

Having documentation as the core artifact instead of the code has several
advantages. The biggest advantage is the fact that documentation is always
up-to-date. Maintaining the doc is the core concept of this technique. This
process only works if documentation is properly maintained.

All developers hate documenting, but doing it this way makes it easy and even
fun. It's not only about writing endless Word documents, it's about writing
markdown in GitHub, with AI, just like if it was code. Think of it as a higher
level programming language.

## Key Advantages

1. **Code can be done with AI, but it needs useful specs** - AI excels at
   implementation when given clear specifications
2. **New features can be implemented easily** - Well-documented features provide
   clear implementation paths
3. **Tests can be generated** - Documentation provides the foundation for
   comprehensive test generation
4. **Other documentation artifacts can be generated with minimal effort** - Can
   generate User Stories, list of Tasks, User Guides, Architecture diagrams, and
   more

## Working on Documentation

1. Drop specs + data model in Google AI Studio/Claude etc.
2. Brainstorm, then when done, ask to help update the doc.

**Update Instructions Template** Give these instructions when updating
documentation:

> Give me the finalized versions of the update documentation. We will do 1 or 2
> sections at a time so I can review and fix as we go. Each time you output a
> section, ask questions whenever you encounter an assumption. We will address
> them first, before continuing with the other updates.
>
> Also, very important to preserve the full content, do not put meta comments
> like "As previously documented" or "No changes to this section" etc. I want
> you to output the entire sections so do not be lazy.
>
> Whenever you rewrite a section, keep the same amount of verbosity, no more no
> less. The documents are used for further chat sessions and we try to keep the
> token count to the essential. Also, since I will use diff to compare changes,
> only change what's relevant so that it's easy for me to spot the changes.
>
> Also, don't put emphasis on our latest changes like putting in bold or adding
> more comments than needed, straight final version as if I never read the
> document and want a finalized version.

3. Update documentation, one section at a time, reviewing to ensure nothing is
   omitted and that not more text than necessary has been given by the AI.
4. If updates to data model, provide the Prisma schema and ask to update.

## Working on Code with This Documentation

Since the docs are large and impractical to work in individual coding sessions,
we need streamlined instructions about the work we will do in this chat session.
Otherwise, the full context window would be filled with these documents and AI
would hallucinate a lot.

### Code Implementation Process

1. Drop specs + data model in Google AI Studio/Claude etc.
2. Tell AI to generate only what's needed to build a screen. Use this prompt:

> Since there is a lot of info in these docs to process by a less capable AI,
> which will be doing the implementation job, give me all it needs to properly
> implement the code to display "XYZ FEATURE HERE". Don't give me the code, just
> the instructions an AI would need.

3. With this output, copy that in your IDE (Cursor, VS Code with Copilot, etc.)
   or use a separate web chat session with your code.
