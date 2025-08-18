// src/services/relatorioExport.ts
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";

export type CabecalhoRelatorio = {
  linhaTopo: string;
  blocoCompleto: string;
  apenasCgim?: string;
};

export type ItemExport = {
  indice: number;
  secaoTitulo: string;
  tipoPleito: string;
  ncm: string;
  produto: string;
  pleiteante: string;
  infoDaPauta: Record<string, string>;
  analise: {
    resumo?: string;
    comercio?: string;
    tecnica?: string;
    sugestao?: string;
  };
};

type ExportArgs = {
  cabecalho: CabecalhoRelatorio;
  itens: ItemExport[] | undefined | null;
  nomeArquivo: string;
};

function H1(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
  });
}

function H2(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
  });
}

function small(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    spacing: { after: 80 },
  });
}

function labelValue(label: string, value?: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: label + ": ", bold: true }),
      new TextRun({ text: (value ?? "").trim() || "—" }),
    ],
    spacing: { after: 60 },
  });
}

function block(title: string, content?: string) {
  const txt = (content ?? "").trim();
  if (!txt) return [];
  return [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true })],
      spacing: { before: 160, after: 60 },
    }),
    new Paragraph(txt),
  ];
}

export async function exportRelatorioDocx({
  cabecalho,
  itens,
  nomeArquivo,
}: ExportArgs) {
  const safeItens = Array.isArray(itens) ? itens : [];

  const sections: any[] = [];
  sections.push({
    properties: {},
    children: [
      small(cabecalho.linhaTopo || ""),
      H1(cabecalho.blocoCompleto || "Relatório"),
      cabecalho.apenasCgim ? small(cabecalho.apenasCgim) : new Paragraph({}),
    ],
  });

  for (const it of safeItens) {
    const header = new Paragraph({
      children: [
        new TextRun({ text: `${it.indice}. NCM ${it.ncm}`, bold: true }),
        new TextRun({ text: "  " }),
        new TextRun({
          text: `${it.secaoTitulo || ""}${it.tipoPleito ? ` • ${it.tipoPleito}` : ""}`,
          italics: true,
        }),
      ],
      spacing: { before: 200, after: 100 },
    });

    const metas = [
      labelValue("Pleiteante", it.pleiteante),
      labelValue("Produto", it.produto),
    ];

    const infoRows: TableRow[] = [];
    const entries = Object.entries(it.infoDaPauta || {});
    for (const [k, v] of entries) {
      const label = String(k || "").trim();
      const val = String(v ?? "").trim();
      if (!label) continue;
      infoRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ children: [new TextRun({ text: label, bold: true })] }),
              ],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE },
              children: [new Paragraph(val || "—")],
            }),
          ],
        })
      );
    }

    const infoTable =
      infoRows.length > 0
        ? [
            new Paragraph({
              children: [new TextRun({ text: "Informações da Pauta", bold: true })],
              spacing: { before: 160, after: 80 },
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: infoRows,
            }),
          ]
        : [];

    const analise = [
      ...block("Resumo", it.analise?.resumo),
      ...block("Comércio", it.analise?.comercio),
      ...block("Análise Técnica", it.analise?.tecnica),
      ...block("Sugestão CGIM", it.analise?.sugestao),
    ];

    sections.push({
      properties: {},
      children: [header, ...metas, ...infoTable, ...analise],
    });
  }

  const doc = new Document({
    sections,
    styles: {
      default: {
        document: {
          run: { size: 24 }, // ~12pt
          paragraph: { alignment: AlignmentType.JUSTIFIED },
        },
      },
    },
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, nomeArquivo);
}
