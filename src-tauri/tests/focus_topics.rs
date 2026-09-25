use news_terminal_lib::topics::{classify, FocusSection};
use serde_json::json;

#[test]
fn classifies_ai_stocks_and_others_without_substring_false_positives() {
    let ai = classify(
        &json!({"id":"openai-news","topics":["ai","technology"],"kind":"official notice"}),
        "OpenAI releases a new model for agents",
        "The release notes describe model capabilities and developer tools.",
    );
    assert_eq!(
        ai.sections,
        vec![FocusSection::Ai, FocusSection::Technology]
    );
    assert!(ai.labels.contains(&"Model releases".to_string()));

    let chip_earnings = classify(
        &json!({"id":"cnbc-tech","topics":["technology","markets"],"kind":"reporting"}),
        "Nvidia shares rise after AI chip earnings beat",
        "Semiconductor demand lifted revenue and market forecasts.",
    );
    assert_eq!(
        chip_earnings.sections,
        vec![
            FocusSection::Ai,
            FocusSection::Technology,
            FocusSection::Stocks
        ]
    );

    let airline = classify(
        &json!({"id":"business-wire","topics":["business"],"kind":"reporting"}),
        "Airline workers approve a new labor contract",
        "The company said the agreement covers airport staff.",
    );
    assert_eq!(airline.sections, vec![FocusSection::Others]);

    let custom = classify(
        &json!({"id":"custom","topics":["local-civic"],"kind":"reporting"}),
        "City council approves library renovation",
        "A local civic update.",
    );
    assert_eq!(custom.sections, vec![FocusSection::Others]);
}

#[test]
fn mixed_feed_topics_are_not_dedicated_section_scope() {
    let nvidia_blog = json!({
        "id":"nvidia-blog",
        "topics":["ai","technology","business"],
        "kind":"reporting"
    });
    let geforce = classify(
        &nvidia_blog,
        "GeForce NOW adds five games this week",
        "Players can stream several new releases through the service.",
    );
    assert_eq!(geforce.sections, vec![FocusSection::Others]);

    let guardian_business = json!({
        "id":"guardian-business",
        "topics":["markets","business"],
        "kind":"reporting"
    });
    let labor = classify(
        &guardian_business,
        "Airline workers approve a new labor contract",
        "The agreement covers airport staff and scheduling.",
    );
    assert_eq!(labor.sections, vec![FocusSection::Others]);

    let scoped = classify(
        &json!({
            "id":"openai-news",
            "topics":["ai","technology"],
            "sectionScope":["ai"],
            "kind":"official notice"
        }),
        "Product update for developers",
        "The company published release notes.",
    );
    assert_eq!(
        scoped.sections,
        vec![FocusSection::Ai, FocusSection::Technology]
    );
}

#[test]
fn ambiguous_bare_words_remain_others_without_domain_context() {
    let generic =
        json!({"id":"generic","topics":["business","technology","markets"],"kind":"reporting"});
    for title in [
        "Federal agents arrest suspect",
        "Food security worsens as drought spreads",
        "Prisoner release agreed",
        "Heavy rain floods the capital",
        "SEC football championship kicks off",
        "Flower market reopens after storm",
        "New community platform opens downtown",
        "Neighbors share supplies after outage",
        "Analyst publishes festival attendance estimate",
    ] {
        let result = classify(&generic, title, "");
        assert_eq!(result.sections, vec![FocusSection::Others], "{title}");
    }
}

#[test]
fn space_engineering_requires_specific_technology_phrases() {
    // No source-wide scope, publisher identity, URL or image eligibility needed.
    for source in [
        json!({"id":"generic"}),
        news_terminal_lib::rights::bundled("nasa-technology")
            .unwrap()
            .clone(),
    ] {
        assert!(source.get("sectionScope").is_none());
        for phrase in [
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
        ] {
            for (title, excerpt) in [(phrase, ""), ("New research results", phrase)] {
                let result = classify(&source, title, excerpt);
                assert_eq!(result.sections, vec![FocusSection::Technology], "{phrase}");
                assert!(result
                    .reasons
                    .contains(&"Headline/excerpt contains technology terminology".to_string()));
            }
        }
        let lunar = classify(
            &source,
            "NASA Calls for Proposals to Accelerate Lunar Surface Technologies",
            "",
        );
        assert_eq!(lunar.sections, vec![FocusSection::Technology]);
        for title in [
            "NASA observes a distant galaxy through a telescope",
            "Astronomers discover a planet orbiting a star",
            "Moon observations reveal ancient craters",
            "Rocket launch carries astronauts to the space station",
            "Satellite launches on schedule",
            "Cloudy Cloak Over the Northwest",
            "Anak Krakatau Rumbles Again",
            "NASA Celebrates Restoration of Guam Station Damaged by Typhoon Mawar",
            "Police station opens downtown",
            "City engineering department announces road closure",
            "Gallery offers more space for technology exhibits",
            "Community launches a lunar festival",
            "Satellite communicationsville holds parade",
        ] {
            assert_eq!(
                classify(&source, title, "").sections,
                vec![FocusSection::Others],
                "{title}"
            );
        }
    }
}

#[test]
fn unicode_and_hyphenated_terms_are_preserved() {
    let source = json!({"id":"global-tech","topics":["technology","business"],"kind":"reporting"});
    let ai_powered = classify(
        &source,
        "AI-powered tools arrive",
        "Developers test the new workflow.",
    );
    assert_eq!(
        ai_powered.sections,
        vec![FocusSection::Ai, FocusSection::Technology]
    );

    let chinese_ai = classify(&source, "生成式AI工具發表", "新模型支援企業工作流程。");
    assert_eq!(
        chinese_ai.sections,
        vec![FocusSection::Ai, FocusSection::Technology]
    );

    let chinese_chip = classify(&source, "晶片大廠財報優於預期", "AI晶片需求推動營收成長。");
    assert_eq!(
        chinese_chip.sections,
        vec![
            FocusSection::Ai,
            FocusSection::Technology,
            FocusSection::Stocks
        ]
    );
}
