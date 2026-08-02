from PIL import Image, ImageDraw, ImageFont
import qrcode
import numpy as np

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

def find_orange_buttons(img_array, w, h):
    """Find the orange button regions in the bottom-right quadrant."""
    # Look in bottom-right quadrant only
    search_x_start = w // 2
    search_y_start = int(h * 0.6)
    search_y_end = int(h * 0.92)
    
    region = img_array[search_y_start:search_y_end, search_x_start:, :]
    
    # Orange color: R high, G medium-low, B low
    r = region[:, :, 0].astype(int)
    g = region[:, :, 1].astype(int)
    b = region[:, :, 2].astype(int)
    
    orange_mask = (r > 180) & (g > 60) & (g < 160) & (b < 80)
    
    rows = np.where(orange_mask.any(axis=1))[0]
    cols = np.where(orange_mask.any(axis=0))[0]
    
    if len(rows) == 0 or len(cols) == 0:
        return None
    
    # Get bounding box of orange region
    y1 = rows[0] + search_y_start
    y2 = rows[-1] + search_y_start
    x1 = cols[0] + search_x_start
    x2 = cols[-1] + search_x_start
    
    return x1, y1, x2, y2

def replace_qr_codes(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    img_array = np.array(img)
    print(f"Processing {input_path} ({w}x{h})")

    bounds = find_orange_buttons(img_array, w, h)
    if bounds:
        x1, y1, x2, y2 = bounds
        print(f"  Found orange region: x={x1}-{x2}, y={y1}-{y2}")
    else:
        # Fallback: use known positions from reference
        x1 = int(w * 0.565)
        x2 = int(w * 0.92)
        y1 = int(h * 0.685)
        y2 = int(h * 0.895)
        print(f"  Using fallback positions")

    # Total width of both buttons
    total_w = x2 - x1
    btn_w = int(total_w * 0.47)
    btn_h = y2 - y1
    gap = total_w - btn_w * 2
    
    btn1_x = x1
    btn2_x = x1 + btn_w + gap

    # Draw solid orange rectangles to completely cover old QR buttons
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    orange = (220, 95, 15, 255)
    
    draw.rounded_rectangle([btn1_x, y1, btn1_x + btn_w, y2], radius=14, fill=orange)
    draw.rounded_rectangle([btn2_x, y1, btn2_x + btn_w, y2], radius=14, fill=orange)
    
    img = Image.alpha_composite(img, overlay)
    
    # Add label text
    try:
        font_size = max(18, int(h * 0.022))
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    draw2 = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    line_h = int(h * 0.028)
    
    cx1 = btn1_x + btn_w // 2
    cx2 = btn2_x + btn_w // 2
    
    draw2.text((cx1, y1 + 8), "BOOK FREE", font=font, fill=white, anchor="mt")
    draw2.text((cx1, y1 + 8 + line_h), "ASSESSMENT NOW!", font=font, fill=white, anchor="mt")
    
    draw2.text((cx2, y1 + 8), "CHECK", font=font, fill=white, anchor="mt")
    draw2.text((cx2, y1 + 8 + line_h), "PROMOTIONS NOW!", font=font, fill=white, anchor="mt")
    
    # Paste real QR codes
    label_h = int(h * 0.068)
    qr_size_fit = min(btn_w - 16, btn_h - label_h - 10)
    qr1 = qr_assessment.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    qr2 = qr_promotions.resize((qr_size_fit, qr_size_fit), Image.LANCZOS)
    
    qr_y = y1 + label_h
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
