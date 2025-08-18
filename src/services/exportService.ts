
import saveAs from 'file-saver';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableCell, TableRow, WidthType, VerticalAlign, PageNumber, AlignmentType, Footer, Header } from 'docx';
import { Pleito, SessaoAnalise } from '../types';
import { SESSAO_ANALISE_WORD_ORDER } from '../constants';

const formatField = (label: string, value: any): Paragraph => {
    if (value === undefined || value === null || value === '') {
        return new Paragraph({
            children: [
                new TextRun({ text: `${label}: `, bold: true }),
                new TextRun({ text: "Não informado", italics: true }),
            ],
            spacing: { after: 120 },
        });
    }
    return new Paragraph({
        children: [
            new TextRun({ text: `${label}: `, bold: true }),
            new TextRun(String(value)),
        ],
        spacing: { after: 120 },
    });
};

export const exportPleitosToWord = async (pleitos: Pleito[]): Promise<void> => {
    if (!pleitos.length) {
        alert("Nenhum pleito para exportar.");
        return;
    }

    const groupedPleitos: { [key in SessaoAnalise]?: Pleito[] } = {};
    pleitos.forEach(p => {
        if (!groupedPleitos[p.sessaoAnalise]) {
            groupedPleitos[p.sessaoAnalise] = [];
        }
        groupedPleitos[p.sessaoAnalise]?.push(p);
    });

    const docChildren: any[] = [];

    // 1. Cover Page
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "CGIM - Gestão de Pleitos", size: 48, bold: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 2000, after: 200 },
        }),
        new Paragraph({
            children: [new TextRun({ text: "Documento de Subsídios Técnicos", size: 36 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 2000 },
        }),
        new Paragraph({
            children: [new TextRun({ text: `Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, size: 24 })],
            alignment: AlignmentType.CENTER,
        })
    );
    docChildren.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })] })); // Page break

    // 2. Table of Contents
    docChildren.push(new Paragraph({ text: "Sumário", heading: HeadingLevel.HEADING_1, spacing: { after: 400 } }));

    SESSAO_ANALISE_WORD_ORDER.forEach(sessaoKey => {
        if (groupedPleitos[sessaoKey]) {
            docChildren.push(new Paragraph({
                text: sessaoKey.split(' - ')[1] || sessaoKey,
                heading: HeadingLevel.HEADING_2,
                spacing: { after: 200, before: 300 }
            }));
            groupedPleitos[sessaoKey]?.forEach(p => {
                 docChildren.push(new Paragraph({
                    children: [
                        new TextRun(`NCM ${p.ncm} - ${p.produto}`),
                    ],
                    style: 'ListParagraph',
                    indent: { left: 400 },
                    spacing: { after: 100 },
                }));
            });
        }
    });
    docChildren.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })] }));

    // 3. Body Content
    SESSAO_ANALISE_WORD_ORDER.forEach(sessaoKey => {
        const pleitosDaSessao = groupedPleitos[sessaoKey];
        if (pleitosDaSessao) {
            docChildren.push(new Paragraph({
                text: sessaoKey.split(' - ')[1] || sessaoKey,
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: docChildren.length > 3,
                spacing: { after: 400 },
            }));

            pleitosDaSessao.forEach(p => {
                docChildren.push(new Paragraph({
                    text: `Pleito: NCM ${p.ncm} - ${p.produto}`,
                    heading: HeadingLevel.HEADING_2,
                    spacing: { after: 200, before: 400 },
                }));

                const table = new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [
                                        new Paragraph({ text: "Informações Gerais", style: 'IntenseQuote' }),
                                        formatField("NCM", p.ncm),
                                        formatField("Produto", p.produto),
                                        formatField("Pleiteante", p.pleiteante),
                                        formatField("Tipo de Pleito", p.tipoPleito),
                                        formatField("Status", p.status),
                                        formatField("Prazo", p.prazo),
                                        formatField("Responsável", p.responsavel?.nome),
                                    ],
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    verticalAlign: VerticalAlign.TOP,
                                }),
                                new TableCell({
                                    children: [
                                        new Paragraph({ text: "Dados do Processo (CGIM)", style: 'IntenseQuote' }),
                                        formatField("Seção de Análise", p.sessaoAnalise.split(' - ')[1]),
                                        formatField("Processo SEI Público", p.processoSEIPublico),
                                        formatField("Processo SEI Restrito", p.processoSEIRestrito),
                                        formatField("Nota Técnica", p.notaTecnica),
                                        formatField("Posição CAT", p.posicaoCAT),
                                    ],
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    verticalAlign: VerticalAlign.TOP,
                                }),
                            ],
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [
                                        new Paragraph({ text: "Análise Interna CGIM", style: 'IntenseQuote' }),
                                        formatField("Resumo do Pleito", p.resumoPleito),
                                        formatField("Dados de Comércio", p.dadosComercio),
                                        formatField("Análise Técnica", p.analiseTecnica),
                                        formatField("Sugestão CGIM", p.sugestaoCGIM),
                                    ],
                                    columnSpan: 2
                                }),
                            ],
                        }),
                    ],
                });
                docChildren.push(table);
                docChildren.push(new Paragraph({ spacing: { after: 300 } })); // Spacer
            });
        }
    });

    const doc = new Document({
        sections: [{
            headers: {
                default: new Header({
                    children: [new Paragraph({
                        children: [new TextRun("CGIM - Documento de Subsídios Técnicos")],
                        alignment: AlignmentType.LEFT,
                    })],
                }),
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        children: [
                            new TextRun("Página "),
                            new TextRun({ children: [PageNumber.CURRENT] }),
                            new TextRun(" de "),
                            new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                        ],
                        alignment: AlignmentType.CENTER,
                    })],
                }),
            },
            children: docChildren
        }],
    });

    Packer.toBlob(doc).then(blob => {
        saveAs(blob, `subsidios_cgim_${new Date().toISOString().split('T')[0]}.docx`);
    });
};
