import type { CompanyReport, Finding } from './inspect';

/**
 * The config file, pre-populated with every subject the check found and blank slots for the
 * decisions — so the customer edits a file rather than composing one.
 *
 * Emitted as JSONC with the questions written in as comments beside the slots they belong to. The
 * file is the artifact that gets reviewed as a diff and kept as the record of what was decided, so
 * it is worth it being readable by whoever has to fill it in rather than compact.
 *
 * Every slot is `null` or `""`. Nothing here is a suggestion: a plausible-looking default would be
 * accepted without being read, and a wrong route is not visibly wrong once applied — every
 * downstream rule is *about* the route.
 */
export function templateFor(reports: CompanyReport[]): string {
  return reports.map(sectionFor).join('\n\n') + '\n';
}

const of = (findings: Finding[], kind: Finding['kind']): Finding[] =>
  findings.filter((f) => f.kind === kind);

function sectionFor(report: CompanyReport): string {
  const unmapped = of(report.findings, 'UNMAPPED_TYPE');
  const drafts = of(report.findings, 'UNPUBLISHED_TEMPLATE');
  const chains = of(report.findings, 'PERSON_TARGETED_WORKFLOW');
  const currencies = of(report.findings, 'UNRESOLVABLE_CURRENCY');
  const routes = of(report.findings, 'MISSING_AUTHORING_ROUTE');

  const lines: string[] = [
    `// ${report.company} — ${report.findings.length} decision(s) outstanding as of the check that`,
    '// generated this file. Fill in every "" and null, delete what does not apply, then:',
    `//   pnpm --filter back golive:apply <this file>`,
    '//',
    '// A type this file does not mention is left untouched and reported. That is deliberate:',
    '// omitting a decision must not look like making one.',
    '{',
    `  "company": ${JSON.stringify(report.company)},`,
    '  "documentTypes": {',
  ];

  const typeEntries = [...new Set([...unmapped, ...routes].map((f) => f.subject))].sort();
  lines.push(
    ...typeEntries.map((code, i) => {
      const needsRoute = routes.some((f) => f.subject === code);
      const needsMapping = unmapped.some((f) => f.subject === code);
      const body = [
        `    ${JSON.stringify(code)}: {`,
        needsRoute
          ? '      // Content lives on another table; name the screen that authors it.\n' +
            '      "authoringRoute": "",'
          : '      "authoringRoute": null,',
        needsMapping
          ? '      // Which department raises this, on which form, approved by which workflow.\n' +
            '      "mappings": [{ "department": "", "formTemplate": "", "workflow": "" }]'
          : '      "mappings": []',
        `    }${i === typeEntries.length - 1 ? '' : ','}`,
      ];
      return body.join('\n');
    }),
  );
  lines.push('  },');

  lines.push('  "publishTemplates": [');
  lines.push(
    ...drafts.map(
      (f, i) =>
        `    // ${f.detail}\n    ${JSON.stringify(f.subject)}${i === drafts.length - 1 ? '' : ','}`,
    ),
  );
  lines.push('  ],');

  lines.push('  "workflows": {');
  lines.push(
    ...chains.map((f, i) => {
      const body = [
        `    // ${f.detail}`,
        `    // Leave this out entirely to keep the chain as it is.`,
        `    ${JSON.stringify(f.subject)}: {`,
        '      "steps": [',
        '        { "stepNo": 1, "approverRole": "", "amountMin": null, "amountMax": null }',
        '      ]',
        `    }${i === chains.length - 1 ? '' : ','}`,
      ];
      return body.join('\n');
    }),
  );
  lines.push('  },');

  lines.push('  "exchangeRates": [');
  lines.push(
    ...currencies.map((f, i) => {
      const [from, to] = f.subject.split('->');
      return (
        `    // ${f.detail}\n` +
        `    { "from": ${JSON.stringify(from)}, "to": ${JSON.stringify(to)}, "rate": "", ` +
        `"rateDate": "", "rateType": "DAILY" }${i === currencies.length - 1 ? '' : ','}`
      );
    }),
  );
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n');
}
