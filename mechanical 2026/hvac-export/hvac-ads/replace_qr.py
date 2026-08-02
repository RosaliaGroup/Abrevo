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

def replace_qr_codes(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    print(f"Processing {input_path} ({w}x{h})")

    # The QR codes in the AI images are in the bottom-right area
    # Based on the reference image layout:
    # - Bottom bar: ~bottom 10% of image
    # - QR buttons are just above the bottom bar, right side
    # - Two QR codes side by side, each roughly 15% of image width
    
    bottom_bar_top = int(h * 0.895)
    
    # QR button area: right ~45% of image, above bottom bar
    # Left QR button starts at ~55% width, right at ~73% width
    # QR codes themselves are inside orange buttons
    
    # Determine QR size based on image dimensions - match the existing button size
    qr_size = int(h * 0.165)  # ~165px for 1000px tall image
    
    # Button positions (matching the AI-generated layout)
    # Left button: x from ~57% to ~72%, Right button: x from ~74% to ~89%
    btn1_x = int(w * 0.565)
    btn2_x = int(w * 0.745)
    btn_y_top = int(h * 0.685)  # top of buttons
    btn_w = int(w * 0.165)
    btn_h = bottom_bar_top - btn_y_top - int(h * 0.01)
    
    # Draw orange button backgrounds to cover fake QR codes
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    orange = (220, 95, 15, 255)
    
    # Cover both button areas with orange
    draw.rounded_rectangle([btn1_x, btn_y_top, btn1_x + btn_w, btn_y_top + btn_h], radius=12, fill=orange)
    draw.rounded_rectangle([btn2_x, btn_y_top, btn2_x + btn_w, btn_y_top + btn_h], radius=12, fill=orange)
    
    img = Image.alpha_composite(img, overlay)
    
    # Add label text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(h * 0.022))
    except:
        font = ImageFont.load_default()
    
    draw2 = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    
    cx1 = btn1_x + btn_w // 2
    cx2 = btn2_x + btn_w // 2
    
    draw2.text((cx1, btn_y_top + 8), "BOOK FREE", font=font, fill=white, anchor="mt")
    draw2.text((cx1, btn_y_top + 8 + int(h * 0.026)), "ASSESSMENT NOW!", font=font, fill=white, anchor="mt")
    
    draw2.text((cx2, btn_y_top + 8), "CHECK", font=font, fill=white, anchor="mt")
    draw2.text((cx2, btn_y_top + 8 + int(h * 0.026)), "PROMOTIONS NOW!", font=font, fill=white, anchor="mt")
    
    # Paste real QR codes
    label_h = int(h * 0.065)
    qr_size_fit = min(btn_w - 20, btn_h - label_h - 15)
    qr1 = qr_assessment.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    qr2 = qr_promotions.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    
    qr_y = btn_y_top + label_h
    qr1_x = btn1_x + (btn_w - qr_size_fit) // 2
    qr2_x = btn2_x + (btn_w - qr_size_fit) // 2
    
    img.paste(qr1, (qr1_x, qr_y), qr1)
    img.paste(qr2, (qr2_x, qr_y), qr2)
    
    img = img.convert("RGB")
    img.save(output_path, quality=95)
    print(f"  -> Saved: {output_path}")

images = [
    ("/home/ubuntu/hvac-ads/oil-funny-v2.jpg",  "/home/ubuntu/hvac-ads/oil-fixed.jpg"),
    ("/home/ubuntu/hvac-ads/rebate-funny.jpg",  "/home/ubuntu/hvac-ads/rebate-fixed.jpg"),
    ("/home/ubuntu/hvac-ads/hvac-funny.jpg",    "/home/ubuntu/hvac-ads/hvac-fixed.jpg"),
]

for inp, out in images:
    replace_qr_codes(inp, out)

print("\nAll done!")
