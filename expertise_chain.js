def develop_feature(action_context: ActionContext, feature_request:str) ->dict:
    """
    Process a feature request through a chain of expert personas.
    """
    # Step 1: Product expert defines requirements
    requirements= prompt_expert(
        action_context,
        "product manager expert",
        f"Convert this feature request into detailed requirements:{feature_request}"
    )

    # Step 2: Architecture expert designs the solution
    architecture= prompt_expert(
        action_context,
        "software architect expert",
        f"Design an architecture for these requirements:{requirements}"
    )

    # Step 3: Developer expert implements the code
    implementation= prompt_expert(
        action_context,
        "senior developer expert",
        f"Implement code for this architecture:{architecture}"
    )

    # Step 4: QA expert creates test cases
    tests= prompt_expert(
        action_context,
        "QA engineer expert",
        f"Create test cases for this implementation:{implementation}"
    )

    # Step 5: Documentation expert creates documentation
    documentation= prompt_expert(
        action_context,
        "technical writer expert",
        f"Document this implementation:{implementation}"
    )

    return {
        "requirements": requirements,
        "architecture": architecture,
        "implementation": implementation,
        "tests": tests,
        "documentation": documentation
    }