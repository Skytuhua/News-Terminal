use serde::Serialize;
use serde_json::{json, Value};

pub const CLASSIFICATION_VERSION: u64 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusSection {
    Ai,
    Technology,
    Stocks,
    Others,
}

impl FocusSection {
    pub fn as_str(&self) -> &'static str {
        match self {
            FocusSection::Ai => "ai",
            FocusSection::Technology => "technology",
            FocusSection::Stocks => "stocks",
            FocusSection::Others => "others",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub sections: Vec<FocusSection>,
    pub labels: Vec<String>,
    pub reasons: Vec<String>,
}

fn values(v: &Value) -> Vec<&str> {
    v.as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn normalized_haystack(title: &str, excerpt: &str) -> String {
    let mut out = String::from(" ");
    for ch in format!("{title} {excerpt}").chars() {
        for lower in ch.to_lowercase() {
            if lower.is_alphanumeric() || lower == '+' {
                out.push(lower);
            } else {
                out.push(' ');
            }
        }
    }
    out.push(' ');
    format!(" {} ", out.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn has_word(hay: &str, word: &str) -> bool {
    hay.split_whitespace().any(|token| token == word)
}

fn has_any_phrase(hay: &str, phrases: &[&str]) -> bool {
    phrases.iter().any(|phrase| {
        let phrase = normalized_haystack(phrase, "");
        let phrase = phrase.trim();
        if phrase.contains(' ') {
            hay.contains(&format!(" {phrase} "))
        } else if phrase
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+')
        {
            has_word(hay, phrase)
        } else {
            hay.contains(phrase)
        }
    })
}

fn has_any_word(hay: &str, words: &[&str]) -> bool {
    words.iter().any(|word| has_word(hay, word))
}

fn has_cjk_or_mixed(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| hay.contains(needle))
}

fn has_acronym(hay: &str, acronym: &str) -> bool {
    has_word(hay, acronym)
        || hay
            .split_whitespace()
            .any(|token| token.contains(acronym) && !token.is_ascii())
}

fn add_section(sections: &mut Vec<FocusSection>, section: FocusSection) {
    if !sections.contains(&section) {
        sections.push(section);
    }
}

fn source_scope(source: &Value, section: &str) -> bool {
    values(&source["sectionScope"]).contains(&section)
}

pub fn classify(source: &Value, title: &str, excerpt: &str) -> Classification {
    let hay = normalized_haystack(title, excerpt);
    let mut sections = Vec::new();
    let mut labels = Vec::new();
    let mut reasons = Vec::new();

    let ai_source = source_scope(source, "ai");
    let ai_terms = has_acronym(&hay, "ai")
        || has_any_phrase(
            &hay,
            &[
                "a i",
                "artificial intelligence",
                "generative ai",
                "genai",
                "llm",
                "large language model",
                "machine learning",
                "neural network",
                "openai",
                "anthropic",
                "claude",
                "gpt",
                "gemini",
                "deepmind",
                "hugging face",
                "openrouter",
                "model release",
                "foundation model",
                "ai agent",
                "ai agents",
                "agentic ai",
                "inference",
                "transformer",
            ],
        )
        || has_cjk_or_mixed(
            &hay,
            &["人工智能", "生成式ai", "大模型", "ai晶片", "ai芯片"],
        );
    if ai_source || ai_terms {
        add_section(&mut sections, FocusSection::Ai);
        reasons.push(if ai_source {
            "Source declares an explicit AI section scope".to_owned()
        } else {
            "Headline/excerpt contains AI-specific terminology".to_owned()
        });
        if has_any_phrase(
            &hay,
            &[
                "model",
                "gpt",
                "claude",
                "gemini",
                "openrouter",
                "hugging face",
            ],
        ) {
            labels.push("Model releases".to_owned());
        }
        if has_any_phrase(&hay, &["benchmark", "arena", "swe-bench", "leaderboard"]) {
            labels.push("Benchmarks".to_owned());
        }
    }

    let technology_source = source_scope(source, "technology");
    let technology_terms = has_any_word(
        &hay,
        &[
            "chip",
            "chips",
            "semiconductor",
            "gpu",
            "cpu",
            "software",
            "developer",
            "cybersecurity",
            "cyberattack",
            "cyber",
            "vulnerability",
            "hardware",
            "github",
            "browser",
            "robotics",
            "electronics",
            "processor",
        ],
    ) || has_any_phrase(
        &hay,
        &[
            "cloud computing",
            "data center",
            "open source",
            "quantum computing",
            "zero day",
            // Specific engineering evidence, not bare space/launch/station terms.
            "lunar surface technology",
            "lunar surface technologies",
            "spacecraft engineering",
            "spacecraft propulsion",
            "space propulsion",
            "satellite communications",
            "in-space manufacturing",
            "in-situ resource utilization",
            "thermal protection system",
            "thermal protection systems",
            "rocket engine",
            "rocket engines",
            "additive manufacturing",
        ],
    ) || has_cjk_or_mixed(
        &hay,
        &["晶片", "芯片", "半導體", "半导体", "軟體", "软件", "電子"],
    );
    if technology_source || technology_terms || sections.contains(&FocusSection::Ai) {
        add_section(&mut sections, FocusSection::Technology);
        if technology_source {
            reasons.push("Source declares an explicit technology section scope".to_owned());
        } else if technology_terms {
            reasons.push("Headline/excerpt contains technology terminology".to_owned());
        }
        if has_any_phrase(&hay, &["chip", "semiconductor", "gpu", "cpu"])
            || has_cjk_or_mixed(&hay, &["晶片", "芯片", "半導體", "半导体"])
        {
            labels.push("Hardware/Semiconductors".to_owned());
        }
        if has_any_phrase(
            &hay,
            &[
                "cybersecurity",
                "cyberattack",
                "breach",
                "vulnerability",
                "zero day",
            ],
        ) {
            labels.push("Cybersecurity".to_owned());
        }
    }

    let market_source = source_scope(source, "stocks");
    let share_context = [
        "shares rise",
        "shares rose",
        "shares fall",
        "shares fell",
        "shares climb",
        "shares climbed",
        "shares jump",
        "shares jumped",
        "shares drop",
        "shares dropped",
        "shares slide",
        "shares slid",
        "shares tumble",
        "shares tumbled",
        "shares gain",
        "shares gained",
        "shares lose",
        "shares lost",
        "shares trade",
        "shares traded",
        "shares surge",
        "shares surged",
    ];
    let analyst_context = [
        "analyst upgrade",
        "analyst upgrades",
        "analyst downgrade",
        "analyst downgrades",
        "analyst raises",
        "analyst lowers",
        "analysts upgrade",
        "analysts downgrade",
        "analysts raise",
        "analysts lower",
    ];
    let market_terms = has_any_word(
        &hay,
        &[
            "stock",
            "stocks",
            "earnings",
            "revenue",
            "profit",
            "profits",
            "investor",
            "investors",
            "filing",
            "filings",
            "ipo",
        ],
    ) || has_any_phrase(&hay, &share_context)
        || has_any_phrase(&hay, &analyst_context)
        || has_any_phrase(
            &hay,
            &[
                "stock market",
                "financial markets",
                "market rally",
                "market selloff",
                "bond market",
                "equity market",
                "capital markets",
                "sec filing",
                "sec filings",
                "securities and exchange",
                "federal reserve",
                "central bank",
                "interest rate",
            ],
        )
        || has_cjk_or_mixed(
            &hay,
            &[
                "財報", "财报", "營收", "营收", "獲利", "获利", "利潤", "利润", "股價", "股价",
                "股票",
            ],
        );
    if market_source || market_terms {
        add_section(&mut sections, FocusSection::Stocks);
        reasons.push(if market_source {
            "Source declares an explicit stocks section scope".to_owned()
        } else {
            "Headline/excerpt contains stock or market terminology".to_owned()
        });
        if has_any_phrase(&hay, &["earnings", "revenue", "profit"]) {
            labels.push("Earnings".to_owned());
        }
        if has_any_phrase(&hay, &["filing", "sec"]) {
            labels.push("Filings/Corporate actions".to_owned());
        }
    }

    if sections.is_empty() {
        sections.push(FocusSection::Others);
        reasons.push("No focused-section evidence; kept under Others".to_owned());
    }

    sections.sort_by_key(|section| match section {
        FocusSection::Ai => 0,
        FocusSection::Technology => 1,
        FocusSection::Stocks => 2,
        FocusSection::Others => 3,
    });
    labels.sort();
    labels.dedup();
    reasons.sort();
    reasons.dedup();

    Classification {
        sections,
        labels,
        reasons,
    }
}

pub fn apply(source: &Value, article: &mut Value) {
    let classification = classify(
        source,
        article["title"].as_str().unwrap_or(""),
        article["excerpt"].as_str().unwrap_or(""),
    );
    article["classificationVersion"] = json!(CLASSIFICATION_VERSION);
    article["sections"] = json!(classification
        .sections
        .iter()
        .map(FocusSection::as_str)
        .collect::<Vec<_>>());
    article["topicLabels"] = json!(classification.labels);
    article["classificationReasons"] = json!(classification.reasons);
}
