//! Spec: drawing the maths in a note with the real Typst compiler, so the editor can show
//! `$x^2$` as a formula instead of code.

use marginalia_lib::maths::render_maths;

/// The width and height an SVG declares, in points.
fn size_of(svg: &str) -> (f64, f64) {
    let number = |attribute: &str| -> f64 {
        let start = svg.find(&format!("{attribute}=\"")).unwrap() + attribute.len() + 2;
        let rest = &svg[start..];
        rest[..rest.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap()].parse().unwrap()
    };
    (number("width"), number("height"))
}

mod drawing_maths {
    use super::*;

    #[test]
    fn draws_the_maths_as_an_svg_picture() {
        let svg = render_maths("$x^2 + y^2 = z^2$").unwrap();

        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("</svg>"));
    }

    /// No page and no margins: the picture fits in a line of text.
    #[test]
    fn the_picture_is_only_as_big_as_the_maths() {
        let (width, height) = size_of(&render_maths("$x$").unwrap());

        assert!(width > 0.0 && width < 20.0, "width was {width}");
        assert!(height > 0.0 && height < 30.0, "height was {height}");
    }

    #[test]
    fn the_same_maths_always_gives_the_same_picture() {
        assert_eq!(render_maths("$a/b$").unwrap(), render_maths("$a/b$").unwrap());
    }

    #[test]
    fn different_maths_gives_a_different_picture() {
        assert_ne!(render_maths("$a/b$").unwrap(), render_maths("$b/a$").unwrap());
    }

    /// In Typst, spaces inside the dollars make a display equation, drawn bigger.
    #[test]
    fn maths_with_spaces_inside_the_dollars_is_drawn_as_a_display_equation() {
        let (_, inline) = size_of(&render_maths("$sum_(i=0)^n i$").unwrap());
        let (_, display) = size_of(&render_maths("$ sum_(i=0)^n i $").unwrap());

        assert!(display > inline, "display {display} should be taller than inline {inline}");
    }
}

mod maths_with_mistakes {
    use super::*;

    #[test]
    fn explains_what_is_wrong() {
        let error = render_maths("$frac(1, $").unwrap_err();

        assert!(!error.is_empty());
        assert!(error.chars().next().unwrap().is_uppercase(), "readable message: {error}");
    }

    #[test]
    fn something_that_isnt_maths_is_refused() {
        assert!(render_maths("x^2").is_err());
        assert!(render_maths("$x$ and more").is_err());
    }

    /// Maths only draws formulas: it can't read files on the computer or download packages.
    #[test]
    fn maths_cant_read_files_or_download_packages() {
        assert!(render_maths("$#read(\"/etc/hosts\")$").is_err());
        assert!(render_maths("$#import \"@preview/cetz:0.4.0\"$").is_err());
    }
}
