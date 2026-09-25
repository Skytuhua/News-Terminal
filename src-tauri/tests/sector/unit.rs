use super::*;

#[test]
fn candidate_prompt_offers_host_bound_quotations_not_model_transcription() {
    let selection = Selection {
        preview: json!({"sources":[{"id":"S1"},{"id":"S2"}]}),
        articles: vec![
            json!({"title":"AL90 outlook","excerpt":"AL90 has a 60 percent chance. Fay is a separate system."}),
            json!({"title":"Fay forecast","excerpt":"Weak shear persists for 36 hours. By 48 hours, shear increases."}),
        ],
        providers: vec![],
    };
    let data: Value = serde_json::from_str(&prompt(&selection).unwrap()).unwrap();
    let candidates = data["candidates"]
        .as_array()
        .expect("host-generated candidate list");
    assert!(!candidates.is_empty());
    let mut ids = std::collections::HashSet::new();
    for candidate in candidates {
        assert!(ids.insert(candidate["id"].as_str().unwrap()));
        let source = candidate["sourceId"].as_str().unwrap();
        let quote = candidate["quote"].as_str().unwrap();
        assert!(
            validate_bullets(&quoted(quote, source, quote).to_string(), &data["sources"]).is_ok()
        );
    }
    assert!(SYSTEM.contains("selectedCandidateIds"));
    assert!(!SYSTEM.contains("Exact sentence copied"));
}

#[test]
fn candidates_omit_host_clipped_numeric_tails_and_keep_sentence_context() {
    for tail in ["60 percent.", "2.5 percent.", "-60 percent."] {
        let context = "AL90 may develop. This does not concern Fay. ".repeat(40);
        // Cut through a number, including immediately after the decimal dot.
        let numeric_prefix = if tail == "2.5 percent." {
            "2."
        } else {
            &tail[..1]
        };
        let prefix = format!(
            "{}{}",
            context,
            "x".repeat(2000 - context.len() - numeric_prefix.len())
        );
        let selection = Selection {
            preview: json!({"sources":[{"id":"S1"},{"id":"S2"}]}),
            articles: vec![
                json!({"title":format!("{}{}", "x".repeat(500 - numeric_prefix.len()), tail),"excerpt":format!("{prefix}{tail}")}),
                json!({"title":"Other complete headline","excerpt":"Chance is 2.5 percent, not 60 percent. This does not concern Fay."}),
            ],
            providers: vec![],
        };
        let data: Value = serde_json::from_str(&prompt(&selection).unwrap()).unwrap();
        let candidates = data["candidates"].as_array().unwrap();
        let first: Vec<_> = candidates
            .iter()
            .filter(|c| c["sourceId"] == "S1")
            .collect();
        assert!(
            first
                .iter()
                .all(|c| !c["quote"].as_str().unwrap().contains('x')),
            "clipped title or numeric sentence offered: {first:?}"
        );
        assert!(
            !first.is_empty(),
            "complete sentences before the clipped tail must remain selectable"
        );
        assert!(first.iter().any(|c| c["quote"]
            .as_str()
            .unwrap()
            .contains("AL90 may develop. This does not concern Fay.")));
        assert!(candidates
            .iter()
            .any(|c| c["quote"]
                == "Chance is 2.5 percent, not 60 percent. This does not concern Fay."));
        for c in candidates {
            let q = c["quote"].as_str().unwrap();
            assert!(q.chars().count() <= 700);
            assert!(validate_bullets(
                &quoted(q, c["sourceId"].as_str().unwrap(), q).to_string(),
                &data["sources"]
            )
            .is_ok());
        }
    }
}

#[test]
fn candidates_treat_persisted_parser_limit_as_potential_numeric_truncation() {
    // The feed parser already caps stored text: no extra character survives
    // for inputs() to inspect. A decimal point at that cap is not a sentence.
    let context = "Complete source context. ".repeat(70);
    let clipped = format!("{}{}2.", context, "x".repeat(2000 - context.len() - 2));
    let selection = Selection {
        preview: json!({"sources":[{"id":"S1"},{"id":"S2"}]}),
        articles: vec![
            json!({"title":format!("{}2.","x".repeat(498)),"excerpt":clipped}),
            json!({"title":"Other headline","excerpt":"Other complete source context."}),
        ],
        providers: vec![],
    };
    let data: Value = serde_json::from_str(&prompt(&selection).unwrap()).unwrap();
    assert!(
        data["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| !c["quote"].as_str().unwrap().contains("xxx")),
        "parser-clipped numeric tail offered: {}",
        data["candidates"]
    );
}

#[test]
fn candidates_are_bounded_headline_scoped_plaintext_and_nonempty() {
    let sources = json!([
        {"id":"S1","title":"Headline only","excerpt":"Do not offer this excerpt.","inputLabel":"Headline-only input — no full statement supplied."},
        {"id":"S2","title":"Other headline","excerpt":format!("{} Final incomplete sentence 2", "Complete sentence with a 2.5 percent chance. ".repeat(35))}
    ]);
    let candidates = quotation_candidates(&sources).unwrap();
    assert!(!candidates
        .iter()
        .any(|c| c["quote"] == "Do not offer this excerpt."));
    assert!(candidates.iter().filter(|c| c["sourceId"] == "S2").count() <= 8);
    assert!(!candidates
        .iter()
        .any(|c| c["quote"].as_str().unwrap().contains("Final incomplete")));
    for sources in [
        json!([]),
        json!([{"id":"S1","title":"https://evil.example/path","excerpt":"www.evil.example <tag>"}]),
        json!([{"id":"S1","title":"x".repeat(701),"excerpt":"y".repeat(701)}]),
        json!([{"id":"S1","title":"Good"},{"id":"S1","title":"Conflicting source"}]),
        json!(vec![json!({"id":"S1","title":"Good"}); LIMIT + 1]),
    ] {
        assert!(
            quotation_candidates(&sources).is_err(),
            "offered invalid map: {sources}"
        );
    }
    let unicode = json!((0..6)
        .map(|i| json!({"id":format!("S{i}"),"title":"雪".repeat(500)}))
        .collect::<Vec<_>>());
    let ids: Vec<_> = quotation_candidates(&unicode)
        .unwrap()
        .iter()
        .map(|c| c["id"].clone())
        .collect();
    assert!(
        selected_bullets(&json!({"selectedCandidateIds":ids}).to_string(), &unicode).is_err(),
        "expanded bullet JSON must retain the 8192-byte bound"
    );
}

#[test]
fn candidate_selection_rejects_duplicates_unknown_ids_cross_source_and_bounds() {
    let sources = json!([
        {"id":"S1","title":"Shared title","excerpt":"AL90 has a 60 percent chance."},
        {"id":"S2","title":"Shared title","excerpt":"Fay weakens by 48 hours."}
    ]);
    let candidates = quotation_candidates(&sources).unwrap();
    let id = &candidates[0]["id"];
    let other = &candidates[2]["id"];
    assert_ne!(
        id, other,
        "same quotation must still bind to its own source"
    );
    let valid = json!({"selectedCandidateIds":[other,id]});
    let bullets = selected_bullets(&valid.to_string(), &sources).unwrap();
    assert_eq!(bullets[0]["citations"], json!(["S2"]));
    assert_eq!(bullets[1]["evidence"][0]["sourceId"], "S1");
    for invalid in [
        json!({"selectedCandidateIds":[id,id]}),
        json!({"selectedCandidateIds":[id,"Q-not-offered"]}),
        json!({"selectedCandidateIds":["S1"]}),
        json!({"selectedCandidateIds":[format!(" {}", id.as_str().unwrap())]}),
        json!({"selectedCandidateIds":[]}),
        json!({"selectedCandidateIds":[null]}),
        json!({"selectedCandidateIds":[1]}),
        json!({"selectedCandidateIds":id}),
        json!({"selectedCandidateIds":vec![id;7]}),
        json!({"selectedCandidateIds":[{"id":id,"sourceId":"S2"}]}),
        json!({"selectedCandidateIds":[id],"sourceId":"S2"}),
        json!({"selectedCandidateIds":[id],"text":"Invented claim."}),
        quoted("Shared title", "S1", "Shared title"),
    ] {
        assert!(
            selected_bullets(&invalid.to_string(), &sources).is_err(),
            "accepted {invalid}"
        );
    }
    for invalid in [
        format!("{{\"selectedCandidateIds\":[{id}],\"selectedCandidateIds\":[{other}]}}"),
        format!("{}{}", valid, " ".repeat(8192)),
        format!("```json\n{valid}\n```"),
    ] {
        assert!(selected_bullets(&invalid, &sources).is_err());
    }
    let moved = json!([{"id":"S2","title":"Shared title"}]);
    assert!(selected_bullets(&json!({"selectedCandidateIds":[id]}).to_string(), &moved).is_err());
    let mut changed = sources.clone();
    changed[0]["excerpt"] = json!("Updated source context.");
    assert!(selected_bullets(&json!({"selectedCandidateIds":[id]}).to_string(), &changed).is_err());
}

#[test]
fn sector_grounding_rejects_actual_native_output_without_supporting_evidence() {
    let capture: Value = serde_json::from_str(include_str!("fixtures/native-r5.json")).unwrap();
    let output = json!({"bullets":capture["hostResult"]["bullets"]});
    assert!(
        validate_bullets(&output.to_string(), &capture["preview"]["sources"]).is_err(),
        "the actual Fay/AL90 misattribution and 48-to-36 output must fail closed"
    );
}

fn retained_inputs() -> Value {
    let capture: Value = serde_json::from_str(include_str!("fixtures/native-r5.json")).unwrap();
    json!(capture["originalInputs"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, a)| json!({"id":format!("S{}",i+1),"title":a["title"],"excerpt":a["excerpt"]}))
        .collect::<Vec<_>>())
}

fn quoted(text: &str, source: &str, quote: &str) -> Value {
    json!({"bullets":[{"text":text,"citations":[source],"evidence":[{"sourceId":source,"quote":quote}]}]})
}

#[test]
fn sector_grounding_rejects_48_to_36_even_when_both_numbers_exist_in_input() {
    let inputs = retained_inputs();
    let exact = "By 48 hours, increasing northeasterly vertical wind shear should work to induce gradual weakening.";
    let changed = exact.replace("48", "36");
    assert!(inputs[1]["excerpt"].as_str().unwrap().contains("36 hours"));
    assert!(
        validate_bullets(&quoted(&changed, "S2", exact).to_string(), &inputs).is_err(),
        "a true quotation does not support a rewritten forecast time"
    );
    assert!(
        validate_bullets(&quoted(&changed, "S2", &changed).to_string(), &inputs).is_err(),
        "invented quotations must also fail"
    );
    assert!(validate_bullets(&quoted(exact, "S2", exact).to_string(), &inputs).is_ok());
}

#[test]
fn sector_grounding_rejects_wrong_source_60_percent_and_same_source_misattribution() {
    let inputs = retained_inputs();
    let probability = "Formation chance through 48 hours...medium...60 percent.";
    let false_claim = "Tropical Storm Fay has a 60 percent formation chance through 48 hours.";
    assert!(inputs[0]["excerpt"].as_str().unwrap().contains(probability));
    assert!(
        validate_bullets(&quoted(probability, "S2", probability).to_string(), &inputs).is_err(),
        "AL90's probability is absent from the Fay source"
    );
    assert!(
        validate_bullets(&quoted(false_claim, "S1", probability).to_string(), &inputs).is_err(),
        "S1 mentions both Fay and AL90; numeric presence alone cannot validate attribution"
    );
    let cross_source = json!({"bullets":[{"text":false_claim,"citations":["S1","S2"],"evidence":[{"sourceId":"S1","quote":probability}]}]});
    assert!(validate_bullets(&cross_source.to_string(), &inputs).is_err());
}

#[test]
fn sector_grounding_rejects_numeric_or_word_fragments() {
    for (input, fragment) in [
        ("Chance: 60 percent.", "0 percent."),
        ("Chance: 2.5 percent.", "5 percent."),
        ("Change: -60 percent.", "60 percent."),
        ("Chance: 60%.", "60"),
        ("The system is unstable.", "stable."),
    ] {
        let inputs = json!([{"id":"S1","excerpt":input}]);
        assert!(
            validate_bullets(&quoted(fragment, "S1", fragment).to_string(), &inputs).is_err(),
            "accepted a clipped token: {fragment} from {input}"
        );
        assert!(validate_bullets(&quoted(input, "S1", input).to_string(), &inputs).is_ok());
    }
}

#[test]
fn sector_grounding_checks_evidence_shape_ids_and_every_bullet() {
    let inputs = retained_inputs();
    let text = "By 48 hours, increasing northeasterly vertical wind shear should work to induce gradual weakening.";
    let valid = quoted(text, "S2", text);
    for evidence in [
        Value::Null,
        json!([]),
        json!([{"sourceId":"S1","quote":text}]),
        json!([{"sourceId":"S999","quote":text}]),
        json!([{"sourceId":2,"quote":text}]),
        json!([{"sourceId":"S2","quote":null}]),
        json!([{"sourceId":"S2","quote":"Invented support."}]),
        json!([{"sourceId":"S2","quote":text,"url":"https://evil.example"}]),
        json!([{"sourceId":"S2","quote":text},{"sourceId":"S2","quote":text}]),
    ] {
        let mut output = valid.clone();
        output["bullets"][0]["evidence"] = evidence;
        assert!(
            validate_bullets(&output.to_string(), &inputs).is_err(),
            "accepted {output}"
        );
    }
    for citations in [
        json!([]),
        json!(["S999"]),
        json!([2]),
        json!(["S2", "S2"]),
        json!(["S1", "S2"]),
    ] {
        let mut output = valid.clone();
        output["bullets"][0]["citations"] = citations;
        assert!(validate_bullets(&output.to_string(), &inputs).is_err());
    }
    let mut output = valid.clone();
    let mut bad = valid["bullets"][0].clone();
    bad["text"] = json!("An unsupported second bullet.");
    output["bullets"].as_array_mut().unwrap().push(bad);
    assert!(
        validate_bullets(&output.to_string(), &inputs).is_err(),
        "must reject the entire response, not return a valid subset"
    );
}

#[test]
fn sector_grounding_uses_only_the_exact_bounded_plain_text_prompt_inputs() {
    let selection = Selection {
        preview: json!({"sources":[{"id":"S1"},{"id":"S2"}]}),
        articles: vec![
            json!({"title":"A &amp; B","excerpt":format!("{} OUTSIDE_SENT_TEXT", "x".repeat(2000)),"sourceName":"Not evidence."}),
            json!({"title":"Other","excerpt":"Plain <b>permitted</b> text."}),
        ],
        providers: vec![],
    };
    let data: Value = serde_json::from_str(&prompt(&selection).unwrap()).unwrap();
    let supplied = inputs(&selection).unwrap();
    assert_eq!(supplied, data["sources"]);
    assert!(validate_bullets(&quoted("A & B", "S1", "A & B").to_string(), &supplied).is_ok());
    assert!(validate_bullets(
        &quoted("OUTSIDE_SENT_TEXT", "S1", "OUTSIDE_SENT_TEXT").to_string(),
        &supplied
    )
    .is_err());
    assert!(validate_bullets(
        &quoted("Not evidence.", "S1", "Not evidence.").to_string(),
        &supplied
    )
    .is_err());
    assert!(validate_bullets(
        &quoted("A &amp; B", "S1", "A &amp; B").to_string(),
        &supplied
    )
    .is_err());
}

#[test]
fn structured_synthesis_accepts_only_bounded_bullets_with_known_nonempty_citations() {
    let sources = json!([{"id":"S1","title":"One development.","excerpt":"Supplied development.","url":"https://example.org/one"},{"id":"S2","title":"Another development.","url":"https://example.org/two"}]);
    let valid = quoted("Supplied development.", "S1", "Supplied development.");
    assert_eq!(
        validate_bullets(&valid.to_string(), &sources).unwrap(),
        valid["bullets"]
    );
    for invalid in [
        json!({"bullets":[]}),
        json!({"bullets":[{"text":"Claim","citations":[]}]}),
        json!({"bullets":[{"text":"Claim","citations":["S3"]}]}),
        json!({"bullets":[{"text":"Claim","citations":[1]}]}),
        json!({"bullets":[{"text":" ","citations":["S1"]}]}),
        json!({"bullets":[{"text":"x".repeat(701),"citations":["S1"]}]}),
        json!({"bullets":[{"text":"Claim","citations":["S1"],"url":"https://evil.example.com"}]}),
        json!({"bullets":[{"text":"Claim https://evil.example.com","citations":["S1"]}]}),
        json!({"bullets":[{"text":"<b>Claim</b>","citations":["S1"]}]}),
        json!({"bullets":vec![json!({"text":"Claim","citations":["S1"]});7]}),
        json!({"bullets":[{"text":"Claim","citations":["S1","S1"]}]}),
        json!({"bullets":[{"text":"Claim","citations":["S1"]}],"url":"https://evil.example.com"}),
    ] {
        assert!(
            validate_bullets(&invalid.to_string(), &sources).is_err(),
            "accepted {invalid}"
        );
    }
    for invalid in ["not json", "```json\n{}\n```", "", &" ".repeat(8193)] {
        assert!(validate_bullets(invalid, &sources).is_err());
    }
}
