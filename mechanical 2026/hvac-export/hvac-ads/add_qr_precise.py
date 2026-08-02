from PIL import Image, ImageDraw, ImageFont
import qrcode

def make_qr(url, size=200):
    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    img = img.resize((size, size), Image.LANCZOS)
    return img

print("Generating real QR codes...")
qr_assessment = make_qr("https://mechanicalenterprise.com/contact")
qr_promotions = make_qr("https://mechanicalenterprise.com/rebates")

def add_qr_precise(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    print(f"Processing {input_path} ({w}x{h})")

    # Match original reference layout exactly:
    # Image is 2400x1792
    # Bottom bar: bottom ~10% = y from ~1610 to 1792
    # QR buttons in original: bottom-right, roughly:
    #   - Two buttons side by side
    #   - Each button ~260px wide, ~300px tall
    #   - Right edge at ~2350, left button starts at ~1830
    #   - Top of buttons at ~1310, bottom at ~1610
    
    bottom_bar_top = int(h * 0.898)  # ~1610
    btn_h = int(h * 0.168)           # ~300px tall
    btn_w = int(w * 0.109)           # ~260px wide
    gap = int(w * 0.012)             # ~28px gap
    right_margin = int(w * 0.017)    # ~40px from right edge
    
    btn2_x = w - right_margin - btn_w
    btn1_x = btn2_x - gap - btn_w
    btn_y = bottom_bar_top - btn_h - int(h * 0.006)
    
    print(f"  Button 1: ({btn1_x},{btn_y}) to ({btn1_x+btn_w},{btn_y+btn_h})")
    print(f"  Button 2: ({btn2_x},{btn_y}) to ({btn2_x+btn_w},{btn_y+btn_h})")

    # Draw orange buttons
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    orange = (220, 95, 15, 255)
    
    draw.rounded_rectangle([btn1_x, btn_y, btn1_x + btn_w, btn_y + btn_h], radius=12, fill=orange)
    draw.rounded_rectangle([btn2_x, btn_y, btn2_x + btn_w, btn_y + btn_h], radius=12, fill=orange)
    
    img = Image.alpha_composite(img, overlay)
    
    # Label text
    try:
        font_size = int(h * 0.020)
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    draw2 = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    line_h = int(h * 0.026)
    
    cx1 = btn1_x + btn_w // 2
    cx2 = btn2_x + btn_w // 2
    
    draw2.text((cx1, btn_y + 8), "BOOK FREE", font=font, fill=white, anchor="mt")
    draw2.text((cx1, btn_y + 8 + line_h), "ASSESSMENT NOW!", font=font, fill=white, anchor="mt")
    
    draw2.text((cx2, btn_y + 8), "CHECK", font=font, fill=white, anchor="mt")
    draw2.text((cx2, btn_y + 8 + line_h), "PROMOTIONS NOW!", font=font, fill=white, anchor="mt")
    
    # QR codes - fit inside buttons below label
    label_h = int(h * 0.062)
    qr_size_fit = min(btn_w - 14, btn_h - label_h - 10)
    qr1 = qr_assessment.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    qr2 = qr_promotions.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    
    qr_y = btn_y + label_h
    qr1_x = btn1_x + (btn_w - qr_size_fit) // 2
    qr2_x = btn2_x + (btn_w - qr_size_fit) // 2
    
    img.paste(qr1, (qr1_x, qr_y), qr1)
    img.paste(qr2, (qr2_x, qr_y), qr2)
    
    img = img.convert("RGB")
    img.save(output_path, quality=95)
    print(f"  -> Saved: {output_path}")

images = [
    ("/home/ubuntu/hvac-ads/oil-clean.jpg",    "/home/ubuntu/hvac-ads/oil-final.jpg"),
    ("/home/ubuntu/hvac-ads/rebate-clean.jpg", "/home/ubuntu/hvac-ads/rebate-final.jpg"),
    ("/home/ubuntu/hvac-ads/hvac-clean.jpg",   "/home/ubuntu/hvac-ads/hvac-final.jpg"),
]

for inp, out in images:
    add_qr_precise(inp, out)

print("\nAll done!")
