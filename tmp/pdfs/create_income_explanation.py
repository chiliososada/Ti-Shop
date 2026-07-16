from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


OUTPUT = "output/pdf/income_zero_explanation_liu_fuxiao.pdf"
FONT_PATH = "tmp/pdfs/NotoSansJP-VF.ttf"
FONT = "NotoSansJP"
pdfmetrics.registerFont(TTFont(FONT, FONT_PATH))

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=23 * mm,
    rightMargin=23 * mm,
    topMargin=18 * mm,
    bottomMargin=18 * mm,
    title="理由書",
    author="劉 富暁",
)

body = ParagraphStyle(
    "body",
    fontName=FONT,
    fontSize=10.5,
    leading=17,
    firstLineIndent=10.5,
    spaceAfter=4.2 * mm,
    wordWrap="CJK",
)
title = ParagraphStyle(
    "title", parent=body, fontSize=16, leading=22, alignment=TA_CENTER,
    firstLineIndent=0, spaceAfter=2 * mm,
)
subtitle = ParagraphStyle(
    "subtitle", parent=body, fontSize=11, leading=16, alignment=TA_CENTER,
    firstLineIndent=0, spaceAfter=7 * mm,
)
recipient = ParagraphStyle(
    "recipient", parent=body, fontSize=10.5, leading=16,
    firstLineIndent=0, spaceAfter=7 * mm,
)
closing = ParagraphStyle(
    "closing", parent=body, fontSize=10.5, leading=17,
    firstLineIndent=0, spaceAfter=0,
)
right = ParagraphStyle(
    "right", parent=body, fontSize=10.5, leading=17, alignment=TA_RIGHT,
    firstLineIndent=0, spaceAfter=0,
)

paragraphs = [
    "私は、申請人の劉 富暁です。",
    "このたび、所得金額が0円となっている理由について、以下のとおりご説明いたします。",
    "私は、出産及び育児のため、当時の勤務先である東陽ソフト株式会社の育児休業制度を利用し、育児休業を取得しておりました。",
    "育児休業期間中は勤務先から給与の支給がなかったため、所得金額が0円となっております。",
    "なお、育児休業期間中は勤務先を退職したものではなく、東陽ソフト株式会社との雇用関係を継続したまま育児休業を取得しておりました。また、育児休業期間中は、ハローワークより育児休業給付金の支給を受けておりました。育児休業給付金は非課税所得であるため、課税証明書の所得金額には含まれておりません。",
    "なお、育児休業給付金の受給状況を確認できる資料として、育児休業給付金支給決定通知書の写しを添付しておりますので、併せてご確認ください。",
    "その後、2025年4月に育児休業を終了し、東陽ソフト株式会社に復職いたしました。",
    "その後、2026年3月末日をもって東陽ソフト株式会社を退職し、同年4月よりマイアークス株式会社に入社いたしました。現在も同社に継続して勤務しており、安定した収入を得ております。",
    "また、配偶者である劉 子源も、永住者として継続して就労し、安定した収入を得ております。そのため、世帯の生活及び生計の維持に問題はございません。",
    "以上が、所得金額が0円となっている理由です。",
]

story = [
    Paragraph("理由書", title),
    Spacer(1, 5 * mm),
    Paragraph("東京出入国在留管理局　松戸出張所　御中", recipient),
]
story.extend(Paragraph(text, body) for text in paragraphs)
story.extend([
    Paragraph("何卒ご理解賜りますよう、よろしくお願い申し上げます。", closing),
    Spacer(1, 7 * mm),
    Paragraph("2026年7月16日", right),
    Spacer(1, 4 * mm),
    Table(
        [
            ["申請人", "劉 富暁"],
            ["住所", "東京都葛飾区堀切1-38-5 601号室"],
            ["署名", "________________________________"],
        ],
        colWidths=[22 * mm, 85 * mm],
        hAlign="RIGHT",
        style=TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 10.5),
            ("LEADING", (0, 0), (-1, -1), 17),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ]),
    ),
])

doc.build(story)
print(OUTPUT)
