from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


OUTPUT = "output/pdf/questionnaire_item7_travel_history.pdf"
FONT = "NotoSansJP"
pdfmetrics.registerFont(TTFont(FONT, "tmp/pdfs/NotoSansJP-VF.ttf"))

records = [
    (1, "2015年4月2日 ～ 2015年10月16日", "留学"),
    (2, "2015年10月24日 ～ 2017年3月31日", "留学"),
    (3, "2017年4月12日 ～ 2017年8月23日", "留学"),
    (4, "2017年9月3日 ～ 2018年11月23日", "留学・仕事"),
    (5, "2018年12月2日 ～ 2018年12月7日", "仕事"),
    (6, "2018年12月9日 ～ 2019年9月13日", "仕事"),
    (7, "2019年9月21日 ～ 2019年12月5日", "仕事"),
    (8, "2019年12月8日 ～ 2019年12月29日", "仕事"),
    (9, "2020年1月3日 ～ 2023年8月4日", "仕事"),
    (10, "2023年8月18日 ～ 2024年9月13日", "育児休暇"),
    (11, "2024年9月20日 ～ 2024年12月29日", "育児休暇"),
    (12, "2025年1月4日 ～ 2025年1月6日", "育児休暇"),
    (13, "2025年1月14日 ～ 2025年7月14日", "育児休暇・仕事"),
    (14, "2025年7月20日 ～ 2025年11月3日", "仕事"),
    (15, "2025年11月9日 ～ 現在", "仕事"),
]

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=14 * mm,
    bottomMargin=14 * mm,
    title="質問書 第7項 申請人の来日歴",
    author="申請人 劉 富暁",
)

base = ParagraphStyle("base", fontName=FONT, fontSize=10, leading=14)
title = ParagraphStyle("title", parent=base, fontSize=16, leading=21, alignment=TA_CENTER, spaceAfter=5 * mm)
meta = ParagraphStyle("meta", parent=base, fontSize=10.5, leading=14)
right = ParagraphStyle("right", parent=base, fontSize=9, alignment=TA_RIGHT)
note = ParagraphStyle("note", parent=base, fontSize=9.5, leading=14)

story = [
    Paragraph("別紙", right),
    Paragraph("質問書　第7項　申請人の来日歴", title),
    Table(
        [[Paragraph("申請人氏名", base), Paragraph("劉　富暁", meta), Paragraph("来日回数", base), Paragraph("15回", meta)]],
        colWidths=[28 * mm, 72 * mm, 28 * mm, 30 * mm],
        rowHeights=[10 * mm],
        style=TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EEEEEE")),
            ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EEEEEE")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]),
    ),
    Spacer(1, 5 * mm),
]

data = [["回数", "来日期間", "来日目的"]] + [[str(n), period, purpose] for n, period, purpose in records]
table = Table(data, colWidths=[18 * mm, 98 * mm, 42 * mm], rowHeights=[9 * mm] + [8.5 * mm] * 15, repeatRows=1)
table.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), FONT),
    ("FONTSIZE", (0, 0), (-1, -1), 9.5),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#D9D9D9")),
    ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
    ("GRID", (0, 0), (-1, -1), 0.55, colors.black),
    ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ("ALIGN", (1, 0), (-1, 0), "CENTER"),
    ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (1, 1), (1, -1), 7),
]))
story.extend([
    table,
    Spacer(1, 4 * mm),
    Paragraph("以上、申請人の来日歴に相違ありません。", note),
    Spacer(1, 5 * mm),
    Table(
        [[Paragraph("作成日：2016年7月16日", base), Paragraph("申請人署名：　　　　　　　　　　　　　　　　", base)]],
        colWidths=[70 * mm, 88 * mm],
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM")]),
    ),
])

doc.build(story)
print(OUTPUT)
